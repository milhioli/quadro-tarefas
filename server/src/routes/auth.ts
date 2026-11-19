import { createHash, timingSafeEqual } from 'node:crypto';
import { devLoginSchema, profileInputSchema, type AuthMethods, type LoginOutcome, type MeResponse } from '@quadro/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { IdentityError, type IdentityClaims, type IdentityProvider } from '../auth/identity';
import { cleanSuggestion, type NameSuggestions } from '../auth/nameSuggestions';
import { PENDING_LOGIN_TTL_MS, type PendingLogins } from '../auth/pendingLogins';
import { sanitizeNext } from '../auth/redirect';
import { clearSessionCookie, setSessionCookie, type SessionCookie } from '../auth/session';
import { HttpError, forbidden } from '../http/errors';
import { ipRateKey, type Limiters } from '../http/rateLimit';
import { validate } from '../http/validate';
import type { Now } from '../clock';
import { auditDeletedAccount, type AccountRepository } from '../repositories/accountRepository';
import type { AuditRepository } from '../repositories/auditRepository';
import type { SessionRepository } from '../repositories/sessionRepository';
import {
  DEV_SUB_PREFIX,
  ProfileExistsError,
  hasProfile,
  type UserRecord,
  type UserRepository,
} from '../repositories/userRepository';

export interface AuthRouteDeps {
  users: UserRepository;
  sessions: SessionRepository;
  audit: AuditRepository;
  cookie: SessionCookie;
  suggestions: NameSuggestions;
  adminEmail: string | null;
  /** Registra `POST /api/auth/dev/login`. Só o entrypoint de E2E (e os testes) liga. */
  devLogin: boolean;
  /** Origem pública do app: o redirect_uri e os destinos depois do login saem daqui, nunca do Host. */
  appOrigin: URL;
  /** Login Google (ou o falso dos testes). Null = sem login Google. */
  identity: IdentityProvider | null;
  /** state, nonce e code_verifier dos logins em andamento (só no servidor). */
  pending: PendingLogins;
  /** Limites de taxa do login (início por IP; contas novas). */
  limits: Pick<Limiters, 'loginStart' | 'signupGlobal' | 'signupPerIp' | 'signupPerSub'>;
  /** Apagar a própria conta. */
  accounts: AccountRepository;
  now: Now;
}

/** Apagar a conta exige uma sessão recém-aberta: quem pegou um cookie antigo não apaga a conta de ninguém. */
export const REAUTH_WINDOW_MS = 10 * 60_000;


export const GOOGLE_START_PATH = '/api/auth/google/start';
export const GOOGLE_CALLBACK_PATH = '/api/auth/google/callback';
/** Cookie com o id do login em andamento, no local (http). */
export const OAUTH_COOKIE = 'quadro_oauth';
export const OAUTH_COOKIE_PATH = '/api/auth';
/** No deploy (https): o prefixo `__Host-` exige Secure e Path=/, sem Domain. */
export const SECURE_OAUTH_COOKIE = '__Host-quadro_oauth';

/** Nome e caminho do cookie do login em andamento, conforme o cookie de sessão. */
export function oauthCookie(cookie: SessionCookie): { name: string; path: string } {
  return cookie.secure ? { name: SECURE_OAUTH_COOKIE, path: '/' } : { name: OAUTH_COOKIE, path: OAUTH_COOKIE_PATH };
}

/** O start só aceita navegação vinda do próprio app ou digitada na barra (O3). */
const START_FETCH_SITES: ReadonlySet<string> = new Set(['same-origin', 'none']);

/** O `sub` só entra no limitador como hash (e só em memória, por até 24 h). */
function subRateKey(sub: string): string {
  return createHash('sha256').update(sub).digest('base64url');
}

function sameSecret(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Resposta de `/api/me` para quem está na requisição. */
export function meResponse(user: UserRecord | null, deps: Pick<AuthRouteDeps, 'users' | 'suggestions'>): MeResponse {
  if (!user) return { user: null, pendingProfile: null };
  if (!hasProfile(user)) return { user: null, pendingProfile: { suggestedName: deps.suggestions.get(user.id) } };
  return { user: deps.users.toMe(user), pendingProfile: null };
}

/**
 * Abre a sessão de uma conta (login concluído): recusa conta desativada,
 * apaga a sessão anterior do cookie e emite um token novo.
 */
export function startSession(
  request: FastifyRequest,
  reply: FastifyReply,
  user: UserRecord,
  deps: Pick<AuthRouteDeps, 'sessions' | 'cookie' | 'audit' | 'users'>,
): void {
  if (user.status !== 'active') throw forbidden();
  const previous = request.cookies[deps.cookie.name];
  if (previous) deps.sessions.delete(previous);
  setSessionCookie(reply, deps.cookie, deps.sessions.create(user.id));
  deps.users.touch(user.id);
  deps.audit.record(user.id, 'login', { kind: 'user', id: user.id });
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): void {
  app.get('/api/auth/methods', { config: { public: true } }, async (): Promise<AuthMethods> => ({
    google: deps.identity?.available() ?? false,
    dev: deps.devLogin,
  }));

  registerGoogleRoutes(app, deps);

  if (deps.devLogin) {
    // Só existe no entrypoint de E2E (server/src/e2eEntry.ts) e nos testes: no servidor normal a rota nem é registrada.
    app.post('/api/auth/dev/login', { config: { public: true } }, async (request, reply): Promise<MeResponse> => {
      const { email } = validate(devLoginSchema, request.body);
      const sub = `${DEV_SUB_PREFIX}${email}`;
      const user = deps.users.findBySub(sub) ?? deps.users.create({ sub, email });
      startSession(request, reply, user, deps);
      if (!hasProfile(user)) deps.suggestions.set(user.id, cleanSuggestion(email.split('@')[0] ?? ''));
      return meResponse(user, deps);
    });
  }

  app.post('/api/auth/logout', { config: { allowPending: true } }, async (request, reply) => {
    if (request.sessionToken) deps.sessions.delete(request.sessionToken);
    clearSessionCookie(reply, deps.cookie);
    if (request.user) deps.audit.record(request.user.id, 'logout', { kind: 'user', id: request.user.id });
    return reply.status(204).send();
  });

  app.get('/api/me', { config: { public: true } }, async (request): Promise<MeResponse> => meResponse(request.user, deps));

  // Apagar a própria conta (LGPD). Vale também para quem não criou o perfil. Sem corpo.
  app.delete('/api/me', { config: { allowPending: true } }, async (request, reply) => {
    const user = request.user as UserRecord;
    if (user.role === 'admin') {
      throw new HttpError(409, 'CONFLICT', 'A conta de administrador não pode ser apagada pelo app.');
    }
    const createdAt = request.sessionToken ? deps.sessions.createdAt(request.sessionToken) : null;
    if (createdAt === null || deps.now().getTime() - Date.parse(createdAt) > REAUTH_WINDOW_MS) {
      throw new HttpError(403, 'REAUTH_REQUIRED', 'Por segurança, entre de novo para apagar a conta.');
    }
    const result = deps.accounts.deleteAccount(user.id);
    if (result) auditDeletedAccount(deps.audit, null, result);
    deps.suggestions.delete(user.id);
    clearSessionCookie(reply, deps.cookie);
    return reply.status(204).send();
  });

  app.post('/api/me/profile', { config: { allowPending: true } }, async (request): Promise<MeResponse> => {
    const user = request.user as UserRecord;
    const profile = validate(profileInputSchema, request.body);
    let updated: UserRecord;
    try {
      updated = deps.users.completeProfile(user.id, profile, deps.adminEmail);
    } catch (error) {
      if (error instanceof ProfileExistsError) throw new HttpError(409, 'CONFLICT', error.message);
      throw error;
    }
    deps.suggestions.delete(user.id);
    deps.audit.record(user.id, 'profile.create', { kind: 'user', id: user.id });
    return meResponse(updated, deps);
  });
}

/**
 * Login Google (authorization code + PKCE + nonce):
 * - start: guarda state, nonce, code_verifier e o destino no servidor
 *   (`pending`), põe só um id aleatório no cookie `quadro_oauth` e manda o
 *   navegador ao Google;
 * - callback: acha e apaga o login pelo id do cookie, confere o state antes
 *   do provedor, troca o code com o redirect_uri do APP_ORIGIN, confere o
 *   e-mail verificado, recusa conta desativada e abre uma sessão nova.
 * Qualquer falha volta para `/?login=...` sem sessão, e o log leva só o tipo.
 */
function registerGoogleRoutes(app: FastifyInstance, deps: AuthRouteDeps): void {
  const appUrl = (path: string) => new URL(path, deps.appOrigin).href;
  const oauth = oauthCookie(deps.cookie);
  const oauthCookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: deps.cookie.secure,
    path: oauth.path,
  };

  function fail(request: FastifyRequest, reply: FastifyReply, reason: string, outcome: LoginOutcome = 'erro') {
    request.log.warn({ kind: 'google-login', status: reason }, 'Login Google não concluído');
    return reply.redirect(appUrl(`/?login=${outcome}`), 303);
  }

  app.get(GOOGLE_START_PATH, { config: { public: true } }, async (request, reply) => {
    // Em outro host (ex.: localhost), o cookie do login ficaria no host errado: volta para o app.
    if (request.headers.host !== deps.appOrigin.host) return reply.redirect(appUrl('/'), 303);
    const site = request.headers['sec-fetch-site'];
    if (typeof site !== 'string' || !START_FETCH_SITES.has(site)) return fail(request, reply, 'fetch-site');
    const identity = deps.identity;
    if (!identity?.available()) return fail(request, reply, 'unavailable', 'indisponivel');
    if (!deps.limits.loginStart.hit(ipRateKey(request.ip))) return fail(request, reply, 'start-limit', 'limite');

    let begun: Awaited<ReturnType<IdentityProvider['begin']>>;
    try {
      begun = await identity.begin(appUrl(GOOGLE_CALLBACK_PATH));
    } catch (error) {
      return fail(request, reply, error instanceof IdentityError ? error.kind : 'begin', 'indisponivel');
    }
    const next = sanitizeNext((request.query as Record<string, unknown>).next, deps.appOrigin);
    const id = deps.pending.put({ checks: begun.checks, next });
    if (id === null) return fail(request, reply, 'busy');
    reply.setCookie(oauth.name, id, { ...oauthCookieOptions, maxAge: Math.floor(PENDING_LOGIN_TTL_MS / 1000) });
    return reply.redirect(begun.authorizationUrl.href, 303);
  });

  app.get(GOOGLE_CALLBACK_PATH, { config: { public: true } }, async (request, reply) => {
    // O login em andamento é apagado já aqui, mesmo que a troca falhe depois: não há segunda tentativa.
    const id = request.cookies[oauth.name];
    reply.clearCookie(oauth.name, oauthCookieOptions);
    const login = id ? deps.pending.take(id) : null;
    if (!login) return fail(request, reply, 'no-pending');

    const query = request.query as Record<string, unknown>;
    if (typeof query.state !== 'string' || !sameSecret(query.state, login.checks.state)) {
      return fail(request, reply, 'state');
    }
    if (query.error !== undefined) return fail(request, reply, 'denied', 'cancelado');
    const identity = deps.identity;
    if (!identity?.available()) return fail(request, reply, 'unavailable', 'indisponivel');

    // A URL de volta sai do APP_ORIGIN (nunca do Host); só a query vem da requisição.
    const queryStart = request.url.indexOf('?');
    const search = queryStart === -1 ? '' : request.url.slice(queryStart);
    let claims: IdentityClaims;
    try {
      claims = await identity.complete(new URL(`${GOOGLE_CALLBACK_PATH}${search}`, deps.appOrigin), login.checks);
    } catch (error) {
      return fail(request, reply, error instanceof IdentityError ? error.kind : 'provider');
    }
    if (!claims.emailVerified) return fail(request, reply, 'unverified');
    // Conta `dev:` só nasce no login de desenvolvimento do entrypoint de E2E.
    if (claims.sub.startsWith(DEV_SUB_PREFIX)) return fail(request, reply, 'dev-sub');

    let user = deps.users.findBySub(claims.sub);
    if (!user) {
      // Conta nova: limites contra contas em série (por conta Google, por IP e no total).
      const allowed =
        deps.limits.signupPerSub.hit(subRateKey(claims.sub)) &&
        deps.limits.signupPerIp.hit(ipRateKey(request.ip)) &&
        deps.limits.signupGlobal.hit('global');
      if (!allowed) return fail(request, reply, 'signup-limit', 'limite');
      user = deps.users.create({ sub: claims.sub, email: claims.email });
    }
    // A pessoa tem o direito de saber por que não entrou (e não "erro").
    if (user.status !== 'active') return fail(request, reply, 'disabled', 'desativada');
    startSession(request, reply, user, deps);
    if (!hasProfile(user) && claims.givenName) deps.suggestions.set(user.id, claims.givenName);
    return reply.redirect(appUrl(login.next), 303);
  });
}
