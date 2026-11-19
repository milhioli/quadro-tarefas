import type { MeResponse } from '@quadro/shared';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { buildApp, type AuthOptions, type BuildAppOptions } from '../../src/app';
import { sessionCookie } from '../../src/auth/session';
import { fixedNow, type Now } from '../../src/clock';
import { publicGuardOptions } from '../../src/config';
import { createTempDb, type TempDb } from './tempDb';

export const TEST_HOST = '127.0.0.1:3001';
export const TEST_ORIGIN = 'http://127.0.0.1:5173';
export const T0 = '2026-11-13T12:00:00.000Z';
export const ADMIN_EMAIL = 'admin@example.com';
export const SESSION_COOKIE = 'quadro_session';

type Method = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

/** Uma pessoa logada: as requisições levam o cookie dela. */
export interface TestClient {
  /** `quadro_session=...` (ou `__Host-quadro_session=...` no modo público), para requisições cruas. */
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
  info?: BuildAppOptions['info'];
  /** Opções de login além do padrão (login de desenvolvimento ligado, admin@example.com). */
  auth?: AuthOptions;
  /**
   * Entra como admin e reclama o quadro legado (1). Padrão: sim. As rotas de
   * tarefas exigem sessão, então quase todo teste começa logado.
   */
  signInAsAdmin?: boolean;
  /**
   * Simula o deploy: APP_ORIGIN https, guard público (Host e Origin dessa
   * origem) e cookies `__Host-`. Ex.: 'https://quadro.exemplo.com'.
   */
  publicOrigin?: string;
  /** Limites de taxa trocados para o teste (padrão: os da tabela). */
  rateLimits?: BuildAppOptions['rateLimits'];
  /** Tetos das tarefas trocados para o teste (padrão: DEFAULT_TASK_LIMITS). */
  taskLimits?: BuildAppOptions['taskLimits'];
}

/** Para onde vão as requisições "legítimas" do teste. */
interface Target {
  host: string;
  origin: string;
  sessionCookie: string;
}

const LOCAL_TARGET: Target = { host: TEST_HOST, origin: TEST_ORIGIN, sessionCookie: SESSION_COOKIE };

function inject(
  app: FastifyInstance,
  target: Target,
  method: Method,
  url: string,
  body: unknown,
  cookie: string | null,
): Promise<LightMyRequestResponse> {
  const headers: Record<string, string> = { host: target.host };
  if (cookie) headers.cookie = cookie;
  if (method !== 'GET' && method !== 'HEAD') {
    headers.origin = target.origin;
    headers['x-quadro-client'] = '1';
  }
  const init: InjectOptions = { method, url, headers };
  if (body !== undefined) init.payload = body as InjectOptions['payload'];
  return app.inject(init);
}

async function signIn(
  app: FastifyInstance,
  target: Target,
  email: string,
  profile: { username: string; displayName: string },
): Promise<TestClient> {
  const login = await inject(app, target, 'POST', '/api/auth/dev/login', { email }, null);
  if (login.statusCode !== 200) throw new Error(`login de teste falhou: ${login.statusCode} ${login.body}`);
  const session = login.cookies.find((c) => c.name === target.sessionCookie);
  if (!session) throw new Error('login de teste sem cookie de sessão');
  const cookie = `${target.sessionCookie}=${session.value}`;

  let me = login.json() as MeResponse;
  if (!me.user) {
    const created = await inject(app, target, 'POST', '/api/me/profile', profile, cookie);
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
    request: (method, url, body) => inject(app, target, method, url, body, cookie),
  };
}

export async function createTestApp(options: CreateTestAppOptions = {}): Promise<TestApp> {
  const temp = options.temp ?? createTempDb();
  const publicOrigin = options.publicOrigin ? new URL(options.publicOrigin) : null;
  const target: Target = publicOrigin
    ? { host: publicOrigin.host, origin: publicOrigin.origin, sessionCookie: sessionCookie(publicOrigin).name }
    : LOCAL_TARGET;
  const app = buildApp({
    db: temp.db,
    now: options.now ?? fixedNow(T0),
    calendar: options.calendar,
    info: options.info,
    rateLimits: options.rateLimits,
    taskLimits: options.taskLimits,
    ...(publicOrigin ? { guard: publicGuardOptions(publicOrigin), behindProxy: true } : {}),
    auth: { adminEmail: ADMIN_EMAIL, devLogin: true, ...(publicOrigin ? { appOrigin: publicOrigin } : {}), ...options.auth },
  });
  await app.ready();

  const admin: TestClient | null =
    (options.signInAsAdmin ?? true)
      ? await signIn(app, target, ADMIN_EMAIL, { username: 'admin.teste', displayName: 'Admin' })
      : null;
  const anonymous: TestClient = {
    cookie: '',
    userId: 0,
    handle: '',
    boardId: 0,
    request: (method, url, body) => inject(app, target, method, url, body, null),
  };
  const self = admin ?? anonymous;

  return {
    ...self,
    app,
    temp,
    raw: (injectOptions) => app.inject(injectOptions),
    anonymous: (method, url, body) => inject(app, target, method, url, body, null),
    signIn: (email, profile) => {
      const local = email.split('@')[0] ?? 'pessoa';
      return signIn(app, target, email, profile ?? { username: local.replace(/[^a-z0-9._]/g, '').padEnd(3, 'x').slice(0, 20), displayName: local });
    },
    async close() {
      await app.close();
      temp.cleanup();
    },
  };
}
