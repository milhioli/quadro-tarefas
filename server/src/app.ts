import type { DatabaseSync } from 'node:sqlite';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyServerOptions,
  type RouteOptions,
} from 'fastify';
import { disabledCalendarService, type CalendarService } from './calendar/calendarService';
import { systemNow, type Now } from './clock';
import { DEFAULT_GUARD_OPTIONS, type GuardOptions } from './config';
import { registerErrorHandling } from './http/errors';
import { registerGuard } from './http/guard';
import { createTaskRepository } from './repositories/taskRepository';
import { registerBoardRoutes } from './routes/board';
import { registerCalendarRoutes } from './routes/calendar';
import { registerHealthRoutes } from './routes/health';
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
}

/** Headers de segurança em toda resposta (inclusive erros e 403 do guard). */
export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onRequest', async (_request, reply) => {
    reply.headers(API_SECURITY_HEADERS);
  });
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: BODY_LIMIT_BYTES,
    trustProxy: false,
    onProtoPoisoning: 'error',
    onConstructorPoisoning: 'error',
  });

  // Só JSON é aceito como corpo; text/plain viraria 415.
  app.removeContentTypeParser('text/plain');

  const onRoute = options.onRoute;
  if (onRoute) app.addHook('onRoute', (route) => onRoute(route));

  // Ordem importa: headers primeiro, depois o guard, ambos na raiz.
  registerSecurityHeaders(app);
  registerGuard(app, options.guard ?? DEFAULT_GUARD_OPTIONS);
  registerErrorHandling(app);

  const now = options.now ?? systemNow;
  const repo = createTaskRepository(options.db, now);
  registerHealthRoutes(app);
  registerTaskRoutes(app, repo);
  registerBoardRoutes(app, repo);
  registerCalendarRoutes(app, options.calendar ? options.calendar(app.log) : disabledCalendarService, now);

  return app;
}
