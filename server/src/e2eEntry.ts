import { resolve } from 'node:path';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { buildApp } from './app';
import { isLoopbackOrigin, loadAuthConfig } from './auth/config';
import type { MutableEnv } from './calendar/config';
import { API_HOST, guardOptionsFor, loadConfig, type Env } from './config';
import { openDatabase } from './db/connection';
import { migrate } from './db/migrations';
import { loadWebDist } from './http/webDist';
import { DEFAULT_DB_PATH, WEB_DIST_DIR, isEntrypoint } from './index';
import { createUserRepository } from './repositories/userRepository';
import { systemNow } from './clock';

/**
 * Servidor do E2E (`npm run dev:e2e`), com o login de desenvolvimento.
 *
 * O `index.ts` não conhece esse login. Este entrypoint:
 * - nunca lê o .env, nunca liga a agenda e desliga o login Google;
 * - recusa subir fora de desenvolvimento/teste, fora do loopback, sem um
 *   banco próprio (DB_PATH explícito e diferente do banco real) ou com
 *   credenciais no ambiente;
 * - recusa um banco que tenha qualquer conta real (sub sem o prefixo `dev:`).
 *
 * Com `--static` (só pela linha de comando, como o `--agenda`), serve também o
 * build do web numa porta única (API_PORT = WEB_PORT), com a CSP do HTML: é o
 * projeto `producao` do Playwright, o único que exercita a CSP estrita.
 */
export class E2eStartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'E2eStartError';
  }
}

const ALLOWED_NODE_ENV: ReadonlySet<string | undefined> = new Set([undefined, '', 'development', 'test']);
const FORBIDDEN_ENV_KEYS = ['GOOGLE_CLIENT_SECRET', 'GOOGLE_CLIENT_ID'] as const;
const FORBIDDEN_ENV_PREFIX = 'ICLOUD_';
/** Liga os estáticos (`npm run dev:e2e:static`). Nunca vem do ambiente. */
export const STATIC_FLAG = '--static';

/** Confere o ambiente antes de abrir qualquer coisa. As mensagens nunca ecoam valores. */
export function assertE2eEnvironment(env: Env): void {
  if (!ALLOWED_NODE_ENV.has(env.NODE_ENV)) {
    throw new E2eStartError('O servidor de E2E só sobe com NODE_ENV ausente, development ou test');
  }
  const dbPath = env.DB_PATH?.trim() ?? '';
  if (dbPath === '' || resolve(dbPath) === DEFAULT_DB_PATH) {
    throw new E2eStartError('O servidor de E2E precisa de um DB_PATH próprio (nunca o server/data/quadro.sqlite)');
  }
  for (const key of FORBIDDEN_ENV_KEYS) {
    if (env[key]?.trim()) throw new E2eStartError(`O servidor de E2E recusa ${key} no ambiente`);
  }
  if (Object.keys(env).some((key) => key.startsWith(FORBIDDEN_ENV_PREFIX) && env[key]?.trim())) {
    throw new E2eStartError('O servidor de E2E recusa credenciais da agenda (ICLOUD_*) no ambiente');
  }
}

/** No E2E, e-mails só de teste (admin e contato); qualquer outro é ignorado. */
export function exampleOnly(raw: string | null): string | null {
  return raw !== null && raw.endsWith('@example.com') ? raw : null;
}

/** O admin do E2E só pode ser uma conta de teste. */
export const e2eAdminEmail = exampleOnly;

/** `--static` exige uma porta só, explícita: o web e a API na mesma origem. */
export function assertStaticPorts(env: Env): void {
  const api = env.API_PORT?.trim() ?? '';
  const web = env.WEB_PORT?.trim() ?? '';
  if (api === '' || web === '' || api !== web || api === '0') {
    throw new E2eStartError('Com --static, defina API_PORT e WEB_PORT iguais (uma porta só para o web e a API)');
  }
}

export interface E2eOptions {
  env?: Env;
  logger?: FastifyServerOptions['logger'];
  /** Linha de comando (padrão: process.argv). Os estáticos só ligam com --static. */
  argv?: readonly string[];
  /** Pasta do build do web com --static. Padrão: WEB_DIST_DIR. */
  webDistDir?: string;
}

export async function startE2eServer(options: E2eOptions = {}): Promise<FastifyInstance> {
  // Cópia: este processo não lê o .env e não mexe no ambiente de quem chamou.
  const env: MutableEnv = { ...(options.env ?? process.env) };
  assertE2eEnvironment(env);
  const serveStatic = (options.argv ?? process.argv).includes(STATIC_FLAG);
  if (serveStatic) assertStaticPorts(env);
  const config = loadConfig(env, { dbPath: DEFAULT_DB_PATH });
  const auth = loadAuthConfig(env, { webPort: config.webPort });
  if (!isLoopbackOrigin(auth.appOrigin)) throw new E2eStartError('O servidor de E2E só aceita APP_ORIGIN em loopback');
  const guard = guardOptionsFor(config);
  if (!guard.allowedOrigins.includes(auth.appOrigin.origin)) {
    throw new E2eStartError('APP_ORIGIN precisa ser uma das origens aceitas pelo guard');
  }

  const webDist = serveStatic ? loadWebDist(options.webDistDir ?? WEB_DIST_DIR) : undefined;

  const db = openDatabase(config.dbPath);
  try {
    migrate(db);
    if (createUserRepository(db, systemNow).countNonDev() > 0) {
      throw new E2eStartError('O banco do E2E tem contas reais: use um DB_PATH novo');
    }
  } catch (error) {
    db.close();
    throw error;
  }

  const app = buildApp({
    db,
    logger: options.logger ?? { level: 'warn' },
    guard,
    webDist,
    // Sem agenda e sem Google, sempre.
    auth: { appOrigin: auth.appOrigin, adminEmail: e2eAdminEmail(auth.adminEmail), identity: null, devLogin: true },
    info: { contactEmail: exampleOnly(auth.contactEmail), operatorName: auth.operatorName },
  });
  app.log.warn('Servidor de E2E: login de desenvolvimento LIGADO (só contas @example.com, banco temporário)');
  app.addHook('onClose', async () => {
    if (db.isOpen) db.close();
  });
  await app.listen({ host: API_HOST, port: config.port });
  return app;
}

if (isEntrypoint(import.meta.url, process.argv[1])) {
  startE2eServer().then(
    (app) => {
      const shutdown = () => {
        app.close().finally(() => process.exit(0));
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    },
    (error: unknown) => {
      console.error('Falha ao iniciar o servidor de E2E:', error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
