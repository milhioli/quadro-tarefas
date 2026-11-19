import type { DatabaseSync } from 'node:sqlite';
import fastifyCookie from '@fastify/cookie';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyServerOptions,
  type RouteOptions,
} from 'fastify';
import type { IdentityProvider } from './auth/identity';
import { createNameSuggestions } from './auth/nameSuggestions';
import { createPendingLogins, type PendingLogins } from './auth/pendingLogins';
import { registerSession, sessionCookie } from './auth/session';
import { disabledCalendarService, type CalendarService } from './calendar/calendarService';
import { systemNow, type Now } from './clock';
import { DEFAULT_GUARD_OPTIONS, type GuardOptions } from './config';
import { registerErrorHandling } from './http/errors';
import { registerGuard } from './http/guard';
import { createAuditRepository } from './repositories/auditRepository';
import { createBoardRepository } from './repositories/boardRepository';
import { createSessionRepository } from './repositories/sessionRepository';
import { createTaskStore } from './repositories/taskRepository';
import { createUserRepository } from './repositories/userRepository';
import { registerAuthRoutes } from './routes/auth';
import { registerBoardRoutes } from './routes/boards';
import { registerCalendarRoutes } from './routes/calendar';
import { registerHealthRoutes } from './routes/health';
import { registerInviteRoutes } from './routes/invites';
import { registerTaskRoutes } from './routes/tasks';

export const BODY_LIMIT_BYTES = 256 * 1024;

export const API_SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
});

export interface BuildAppOptions {
  db: DatabaseSync;
  now?: Now;
  logger?: FastifyServerOptions['logger'];
  guard?: GuardOptions;
  /** Observa cada rota registrada (usado para auditar o guard em teste). */
  onRoute?: (route: RouteOptions) => void;
  /** Agenda da Apple. Ausente = desligada. Recebe o logger do app. */
  calendar?: (log: FastifyBaseLogger) => CalendarService;
  auth?: AuthOptions;
}

export interface AuthOptions {
  /** Origem pública do app. Padrão: http://127.0.0.1:5173. */
  appOrigin?: string | URL;
  /** E-mail que recebe o seq 0 e o papel de admin, uma vez só. */
  adminEmail?: string | null;
  /** Login Google (ou um falso, nos testes). Ausente = sem login Google. */
  identity?: IdentityProvider | null;
  /** Login de desenvolvimento (`POST /api/auth/dev/login`). Só o entrypoint de E2E e os testes ligam. */
  devLogin?: boolean;
  /** Logins Google em andamento. Padrão: um mapa em memória novo (os testes passam um com teto menor). */
  pendingLogins?: PendingLogins;
}

export const DEFAULT_APP_ORIGIN = 'http://127.0.0.1:5173';

/** Headers de segurança em toda resposta (inclusive erros e 403 do guard). */
export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onRequest', async (_request, reply) => {
    reply.headers(API_SECURITY_HEADERS);
  });
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: safeLoggerOptions(options.logger ?? false),
    bodyLimit: BODY_LIMIT_BYTES,
    trustProxy: false,
    onProtoPoisoning: 'error',
    onConstructorPoisoning: 'error',
  });

  // Só JSON é aceito como corpo; text/plain viraria 415.
  app.removeContentTypeParser('text/plain');

  const onRoute = options.onRoute;
  if (onRoute) app.addHook('onRoute', (route) => onRoute(route));

  // Ordem importa (é a ordem de execução dos hooks): headers, guard, erros, cookie, sessão, rotas.
  registerSecurityHeaders(app);
  registerGuard(app, options.guard ?? DEFAULT_GUARD_OPTIONS);
  registerErrorHandling(app);
  app.register(fastifyCookie);

  const now = options.now ?? systemNow;
  const auth = options.auth ?? {};
  const appOrigin = new URL(auth.appOrigin ?? DEFAULT_APP_ORIGIN);
  const cookie = sessionCookie(appOrigin);
  const devLogin = auth.devLogin ?? false;
  const users = createUserRepository(options.db, now);
  const sessions = createSessionRepository(options.db, now);
  const audit = createAuditRepository(options.db, now);
  const suggestions = createNameSuggestions();
  registerSession(app, { users, sessions, cookie, allowDevUsers: devLogin });
  registerAuthRoutes(app, {
    users,
    sessions,
    audit,
    cookie,
    suggestions,
    adminEmail: auth.adminEmail ?? null,
    devLogin,
    appOrigin,
    identity: auth.identity ?? null,
    pending: auth.pendingLogins ?? createPendingLogins(now),
  });

  const store = createTaskStore(options.db, now);
  const boards = createBoardRepository(options.db, now);
  registerHealthRoutes(app);
  registerBoardRoutes(app, { boards, store, users, audit });
  registerTaskRoutes(app, { store, boards });
  registerInviteRoutes(app, { boards, audit });
  registerCalendarRoutes(app, options.calendar ? options.calendar(app.log) : disabledCalendarService, now);

  return app;
}

/**
 * Serializadores do log: só método e caminho, nunca a query (o callback do
 * Google traz `code` e `state`), headers (cookie) nem corpo.
 */
export const SAFE_LOG_SERIALIZERS = Object.freeze({
  req(request: { method: string; url: string }) {
    return { method: request.method, url: request.url.split('?')[0] };
  },
  res(reply: { statusCode: number }) {
    return { statusCode: reply.statusCode };
  },
});

export function safeLoggerOptions(logger: FastifyServerOptions['logger']): FastifyServerOptions['logger'] {
  if (!logger) return false;
  const base = logger === true ? {} : logger;
  return { ...base, serializers: { ...SAFE_LOG_SERIALIZERS } };
}
