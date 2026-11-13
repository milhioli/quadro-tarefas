import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../../src/app';
import { fixedNow, type Now } from '../../src/clock';
import { createTempDb, type TempDb } from './tempDb';

export const TEST_HOST = '127.0.0.1:3001';
export const TEST_ORIGIN = 'http://127.0.0.1:5173';
export const T0 = '2026-11-13T12:00:00.000Z';

type Method = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

export interface TestApp {
  app: FastifyInstance;
  temp: TempDb;
  /** Requisição "legítima": Host correto e header do cliente em mutações. */
  request(method: Method, url: string, body?: unknown): Promise<LightMyRequestResponse>;
  /** Requisição crua, sem headers padrão. */
  raw(options: InjectOptions): Promise<LightMyRequestResponse>;
  close(): Promise<void>;
}

export async function createTestApp(options: { now?: Now; temp?: TempDb } = {}): Promise<TestApp> {
  const temp = options.temp ?? createTempDb();
  const app = buildApp({ db: temp.db, now: options.now ?? fixedNow(T0) });
  await app.ready();

  return {
    app,
    temp,
    request(method, url, body) {
      const headers: Record<string, string> = { host: TEST_HOST };
      if (method !== 'GET' && method !== 'HEAD') headers['x-quadro-client'] = '1';
      const init: InjectOptions = { method, url, headers };
      if (body !== undefined) init.payload = body as InjectOptions['payload'];
      return app.inject(init);
    },
    raw(injectOptions) {
      return app.inject(injectOptions);
    },
    async close() {
      await app.close();
      temp.cleanup();
    },
  };
}
