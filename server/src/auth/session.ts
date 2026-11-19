import type {} from '@fastify/cookie';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Now } from '../clock';
import { needsUsername, unauthenticated } from '../http/errors';
import type { SessionRepository } from '../repositories/sessionRepository';
import { SESSION_MAX_MS, SESSION_TOUCH_MS } from '../repositories/sessionRepository';
import { hasProfile, isDevUser, type UserRecord, type UserRepository } from '../repositories/userRepository';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Rota sem sessão. A lista é fechada e auditada em teste (negação por padrão). */
    public?: boolean;
    /** Rota que aceita sessão de quem ainda não criou o perfil (primeiro acesso). */
    allowPending?: boolean;
  }
  interface FastifyRequest {
    /** Conta da sessão (ativa), ou null. */
    user: UserRecord | null;
    /** Token da sessão do cookie, quando válido. */
    sessionToken: string | null;
  }
}

export interface SessionCookie {
  readonly name: string;
  readonly secure: boolean;
}

/**
 * Nome e flags do cookie. No HTTPS (2b) ganha `Secure` e o prefixo `__Host-`.
 * No 127.0.0.1 o cookie não separa porta: a defesa entre projetos locais é o
 * guard (Origin e X-Quadro-Client).
 */
export function sessionCookie(appOrigin: URL): SessionCookie {
  const secure = appOrigin.protocol === 'https:';
  return { name: secure ? '__Host-quadro_session' : 'quadro_session', secure };
}

export function setSessionCookie(reply: FastifyReply, cookie: SessionCookie, token: string): void {
  reply.setCookie(cookie.name, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookie.secure,
    path: '/',
    maxAge: Math.floor(SESSION_MAX_MS / 1000),
  });
}

export function clearSessionCookie(reply: FastifyReply, cookie: SessionCookie): void {
  reply.clearCookie(cookie.name, { httpOnly: true, sameSite: 'lax', secure: cookie.secure, path: '/' });
}

export interface SessionDeps {
  sessions: SessionRepository;
  users: UserRepository;
  cookie: SessionCookie;
  /** Só no entrypoint de E2E: aceita contas `dev:`. No servidor normal, a sessão delas é ignorada (401). */
  allowDevUsers: boolean;
  /** Para o último acesso da conta (renovado no máximo uma vez por hora). */
  now: Now;
}

/**
 * Dois hooks na raiz, depois do guard e do @fastify/cookie:
 * 1) acha a conta da sessão (só ativa; conta `dev:` só com allowDevUsers);
 * 2) **negação por padrão**: rota sem `config.public` exige sessão; sem perfil,
 *    só as rotas `allowPending`.
 */
export function registerSession(app: FastifyInstance, deps: SessionDeps): void {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionToken', null);

  app.addHook('onRequest', async (request) => {
    const token = request.cookies[deps.cookie.name];
    if (!token) return;
    const userId = deps.sessions.resolve(token);
    if (userId === null) return;
    const user = deps.users.get(userId);
    // Conta que sumiu ou foi desativada: a sessão acaba aqui, não fica sendo renovada.
    if (!user || user.status !== 'active') {
      deps.sessions.delete(token);
      return;
    }
    if (isDevUser(user) && !deps.allowDevUsers) return;
    if (deps.now().getTime() - Date.parse(user.lastSeenAt) >= SESSION_TOUCH_MS) deps.users.touch(user.id);
    request.user = user;
    request.sessionToken = token;
  });

  app.addHook('onRequest', async (request) => {
    // Rota desconhecida (404) também passa por aqui: sem sessão, 401, sem revelar o que existe.
    const config = request.routeOptions.config ?? {};
    if (config.public) return;
    if (!request.user) throw unauthenticated();
    if (!hasProfile(request.user) && !config.allowPending) throw needsUsername();
  });
}
