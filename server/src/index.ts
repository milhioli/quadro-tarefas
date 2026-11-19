import { existsSync } from 'node:fs';
import { normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { buildApp } from './app';
import { AuthConfigError, loadAuthConfig, type GoogleOffReason } from './auth/config';
import { createGoogleProvider } from './auth/googleProvider';
import { createCaldavClient } from './calendar/caldavClient';
import { createCalendarService } from './calendar/calendarService';
import { loadCalendarConfig, type CalendarOffReason, type MutableEnv } from './calendar/config';
import { createGuardedFetch, type OidcFetch } from './calendar/guardedFetch';
import { systemNow } from './clock';
import { API_HOST, guardOptionsFor, loadConfig, type Env } from './config';
import { openDatabase } from './db/connection';
import { migrate } from './db/migrations';

/** Raiz do repositório (server/src/ → ../../). */
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const DEFAULT_DB_PATH = resolve(REPO_ROOT, 'server', 'data', 'quadro.sqlite');

export interface MainOptions {
  env?: Env;
  /** Carrega o .env da raiz, se existir. Desligado nos testes. */
  loadDotEnv?: boolean;
  logger?: FastifyServerOptions['logger'];
  /** Linha de comando (padrão: process.argv). A agenda só liga com --agenda. */
  argv?: readonly string[];
  /** Saída de rede do login Google. Padrão: `createOidcFetch()`. Os testes passam uma falsa (nenhum teste fala com o Google). */
  oidcFetch?: OidcFetch;
}

const GOOGLE_OFF_MESSAGES: Record<GoogleOffReason, string> = {
  'not-configured': 'Login Google: desligado (faltam GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no .env)',
  'tls-disabled': 'Login Google desligado: verificação de TLS desativada no ambiente (NODE_TLS_REJECT_UNAUTHORIZED=0)',
};

const CALENDAR_OFF_MESSAGES: Partial<Record<CalendarOffReason, string>> = {
  'no-credentials': 'Agenda da Apple: --agenda sem ICLOUD_APPLE_ID/ICLOUD_APP_PASSWORD; seguindo sem agenda',
  'tls-disabled': 'Agenda da Apple desligada: verificação de TLS desativada no ambiente (NODE_TLS_REJECT_UNAUTHORIZED=0)',
};

export async function main(options: MainOptions = {}): Promise<FastifyInstance> {
  if (options.loadDotEnv ?? true) {
    const envFile = resolve(REPO_ROOT, '.env');
    if (existsSync(envFile)) process.loadEnvFile(envFile);
  }
  const env = options.env ?? process.env;
  const config = loadConfig(env, { dbPath: DEFAULT_DB_PATH });
  // Lê e apaga o segredo do Google do ambiente.
  const authConfig = loadAuthConfig(env as MutableEnv, { webPort: config.webPort });
  const guard = guardOptionsFor(config);
  if (!guard.allowedOrigins.includes(authConfig.appOrigin.origin)) {
    throw new AuthConfigError('APP_ORIGIN precisa ser uma das origens aceitas pelo guard');
  }
  // Lê e apaga a credencial do ambiente; só liga com --agenda na linha de comando.
  const calendarConfig = loadCalendarConfig(env as MutableEnv, options.argv ?? process.argv);
  const db = openDatabase(config.dbPath);
  migrate(db);

  const google = authConfig.google
    ? createGoogleProvider({
        google: authConfig.google,
        now: systemNow,
        fetch: options.oidcFetch,
        // Só o tipo da falha: nunca URL, corpo nem mensagem da biblioteca.
        onDiscoveryError: (kind) => app.log.warn({ kind, status: 'discovery' }, 'Login Google indisponível: o discovery falhou'),
      })
    : null;

  const app = buildApp({
    db,
    logger: options.logger ?? { level: 'info' },
    guard,
    // Servidor normal: sem login de desenvolvimento (ele só existe no entrypoint de E2E).
    auth: { appOrigin: authConfig.appOrigin, adminEmail: authConfig.adminEmail, identity: google, devLogin: false },
    calendar:
      calendarConfig.status === 'on'
        ? (log) =>
            createCalendarService({
              log,
              createSource: () =>
                createCaldavClient(createGuardedFetch({ authorization: calendarConfig.authorization }), {
                  calendarNames: calendarConfig.calendarNames,
                }),
            })
        : undefined,
  });
  if (authConfig.googleOffReason) app.log.warn(GOOGLE_OFF_MESSAGES[authConfig.googleOffReason]);
  // Discovery em segundo plano: uma falha não derruba o servidor, só deixa o login indisponível (e tenta de novo depois).
  if (google) {
    void google.init().then((ready) => {
      if (ready) app.log.info('Login Google: pronto');
    });
  }
  if (calendarConfig.status === 'on') {
    app.log.info('Agenda da Apple: ligada (somente leitura)');
  } else {
    const message = CALENDAR_OFF_MESSAGES[calendarConfig.reason];
    if (message) app.log.warn(message);
  }
  app.addHook('onClose', async () => {
    if (db.isOpen) db.close();
  });

  await app.listen({ host: API_HOST, port: config.port });
  return app;
}

/** Verdadeiro quando este arquivo é o script executado (tsx src/index.ts). */
export function isEntrypoint(moduleUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false;
  try {
    const self = normalize(fileURLToPath(moduleUrl));
    const script = normalize(resolve(argv1));
    return process.platform === 'win32' ? self.toLowerCase() === script.toLowerCase() : self === script;
  } catch {
    return false;
  }
}

if (isEntrypoint(import.meta.url, process.argv[1])) {
  main().then(
    (app) => {
      const shutdown = () => {
        app.close().finally(() => process.exit(0));
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    },
    (error: unknown) => {
      console.error('Falha ao iniciar a API:', error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
