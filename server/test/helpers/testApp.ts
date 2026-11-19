import type { MeResponse } from '@quadro/shared';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { buildApp, type AuthOptions, type BuildAppOptions } from '../../src/app';
import { fixedNow, type Now } from '../../src/clock';
import { createTempDb, type TempDb } from './tempDb';

export const TEST_HOST = '127.0.0.1:3001';
export const TEST_ORIGIN = 'http://127.0.0.1:5173';
export const T0 = '2026-11-13T12:00:00.000Z';
export const ADMIN_EMAIL = 'admin@example.com';
export const SESSION_COOKIE = 'quadro_session';

type Method = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

/** Uma pessoa logada: as requisições levam o cookie dela. */
export interface TestClient {
  /** `quadro_session=...`, para requisições cruas. */
  cookie: string;
  userId: number;
  handle: string;
  /** Quadro pessoal. */
  boardId: number;
  /** Requisição "legítima": Host, cookie e, em mutações, Origin do Vite e header do cliente. */
  request(method: Method, url: string, body?: unknown): Promise<LightMyRequestResponse>;
}

export interface TestApp extends TestClient {
  app: FastifyInstance;
  temp: TempDb;
  /** Requisição crua, sem headers padrão. */
  raw(options: InjectOptions): Promise<LightMyRequestResponse>;
  /** Requisição "legítima", mas sem sessão. */
  anonymous(method: Method, url: string, body?: unknown): Promise<LightMyRequestResponse>;
  /** Entra com outra conta (login de desenvolvimento) e cria o perfil. */
  signIn(email: string, profile?: { username: string; displayName: string }): Promise<TestClient>;
  close(): Promise<void>;
}

export interface CreateTestAppOptions {
  now?: Now;
  temp?: TempDb;
  calendar?: BuildAppOptions['calendar'];
  /** Opções de login além do padrão (login de desenvolvimento ligado, admin@example.com). */
  auth?: AuthOptions;
  /**
   * Entra como admin e reclama o quadro legado (1). Padrão: sim. As rotas de
   * tarefas exigem sessão, então quase todo teste começa logado.
   */
  signInAsAdmin?: boolean;
}

function inject(
  app: FastifyInstance,
  method: Method,
  url: string,
  body: unknown,
  cookie: string | null,
): Promise<LightMyRequestResponse> {
  const headers: Record<string, string> = { host: TEST_HOST };
  if (cookie) headers.cookie = cookie;
  if (method !== 'GET' && method !== 'HEAD') {
    headers.origin = TEST_ORIGIN;
    headers['x-quadro-client'] = '1';
  }
  const init: InjectOptions = { method, url, headers };
  if (body !== undefined) init.payload = body as InjectOptions['payload'];
  return app.inject(init);
}

async function signIn(
  app: FastifyInstance,
  email: string,
  profile: { username: string; displayName: string },
): Promise<TestClient> {
  const login = await inject(app, 'POST', '/api/auth/dev/login', { email }, null);
  if (login.statusCode !== 200) throw new Error(`login de teste falhou: ${login.statusCode} ${login.body}`);
  const session = login.cookies.find((c) => c.name === SESSION_COOKIE);
  if (!session) throw new Error('login de teste sem cookie de sessão');
  const cookie = `${SESSION_COOKIE}=${session.value}`;

  let me = login.json() as MeResponse;
  if (!me.user) {
    const created = await inject(app, 'POST', '/api/me/profile', profile, cookie);
    if (created.statusCode !== 200) throw new Error(`perfil de teste falhou: ${created.statusCode} ${created.body}`);
    me = created.json() as MeResponse;
  }
  const user = me.user;
  if (!user) throw new Error('perfil de teste sem usuário');
  return {
    cookie,
    userId: user.id,
    handle: user.handle,
    boardId: user.personalBoardId,
    request: (method, url, body) => inject(app, method, url, body, cookie),
  };
}

export async function createTestApp(options: CreateTestAppOptions = {}): Promise<TestApp> {
  const temp = options.temp ?? createTempDb();
  const app = buildApp({
    db: temp.db,
    now: options.now ?? fixedNow(T0),
    calendar: options.calendar,
    auth: { adminEmail: ADMIN_EMAIL, devLogin: true, ...options.auth },
  });
  await app.ready();

  const admin: TestClient | null =
    (options.signInAsAdmin ?? true) ? await signIn(app, ADMIN_EMAIL, { username: 'admin.teste', displayName: 'Admin' }) : null;
  const anonymous: TestClient = {
    cookie: '',
    userId: 0,
    handle: '',
    boardId: 0,
    request: (method, url, body) => inject(app, method, url, body, null),
  };
  const self = admin ?? anonymous;

  return {
    ...self,
    app,
    temp,
    raw: (injectOptions) => app.inject(injectOptions),
    anonymous: (method, url, body) => inject(app, method, url, body, null),
    signIn: (email, profile) => {
      const local = email.split('@')[0] ?? 'pessoa';
      return signIn(app, email, profile ?? { username: local.replace(/[^a-z0-9._]/g, '').padEnd(3, 'x').slice(0, 20), displayName: local });
    },
    async close() {
      await app.close();
      temp.cleanup();
    },
  };
}
