import type { RouteOptions } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createTempDb } from '../../test/helpers/tempDb';
import { createTestApp, type TestApp } from '../../test/helpers/testApp';
import { buildApp } from '../app';
import { DEFAULT_GUARD_OPTIONS } from '../config';
import { isAllowedHost, isAllowedOrigin, isSafeMethod } from './guard';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

describe('isAllowedHost', () => {
  it.each(['127.0.0.1:3001', 'localhost:3001', '127.0.0.1:5173', 'localhost:5173', 'LOCALHOST:3001'])('aceita %s', (host) => {
    expect(isAllowedHost(host, DEFAULT_GUARD_OPTIONS)).toBe(true);
  });

  it.each([
    'localhost.evil.com:3001',
    '127.0.0.1.evil.com:3001',
    'evil.com:3001',
    'evil.com',
    'localhost',
    '127.0.0.1',
    '127.0.0.1:8080',
    '[::1]:3001',
    '0.0.0.0:3001',
    'localhost:3001.evil.com',
    '',
  ])('rejeita "%s"', (host) => {
    expect(isAllowedHost(host, DEFAULT_GUARD_OPTIONS)).toBe(false);
  });

  it('rejeita Host ausente', () => {
    expect(isAllowedHost(undefined, DEFAULT_GUARD_OPTIONS)).toBe(false);
  });
});

describe('isAllowedOrigin', () => {
  it('aceita ausência e as origens exatas do Vite', () => {
    expect(isAllowedOrigin(undefined, DEFAULT_GUARD_OPTIONS)).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:5173', DEFAULT_GUARD_OPTIONS)).toBe(true);
    expect(isAllowedOrigin('http://localhost:5173', DEFAULT_GUARD_OPTIONS)).toBe(true);
  });

  it.each(['null', 'http://localhost:8080', 'http://127.0.0.1:5173.evil.com', 'https://127.0.0.1:5173', 'http://evil.com'])(
    'rejeita %s',
    (origin) => {
      expect(isAllowedOrigin(origin, DEFAULT_GUARD_OPTIONS)).toBe(false);
    },
  );

  it('rejeita Origin repetido (array)', () => {
    expect(isAllowedOrigin(['http://127.0.0.1:5173'], DEFAULT_GUARD_OPTIONS)).toBe(false);
  });
});

describe('isSafeMethod', () => {
  it('só GET e HEAD são seguros; OPTIONS não', () => {
    expect(isSafeMethod('GET')).toBe(true);
    expect(isSafeMethod('head')).toBe(true);
    expect(isSafeMethod('OPTIONS')).toBe(false);
    expect(isSafeMethod('POST')).toBe(false);
  });
});

describe('guard na aplicação', () => {
  it.each(['localhost.evil.com:3001', '127.0.0.1.evil.com:3001', 'evil.com'])('Host %s → 403', async (host) => {
    t = await createTestApp();
    const res = await t.raw({ method: 'GET', url: '/api/tasks', headers: { host } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: { code: 'FORBIDDEN', message: 'Acesso negado' } });
  });

  it.each(['GET', 'POST'] as const)('Origin estranho e "null" → 403 em %s', async (method) => {
    t = await createTestApp();
    for (const origin of ['http://localhost:8080', 'null']) {
      const res = await t.raw({
        method,
        url: '/api/tasks',
        headers: { host: '127.0.0.1:3001', origin, 'x-quadro-client': '1' },
        ...(method === 'POST' ? { payload: { title: 'x' } } : {}),
      });
      expect(res.statusCode).toBe(403);
    }
    expect((await t.request('GET', '/api/tasks')).json()).toEqual({ tasks: [] });
  });

  it('Origin do Vite passa', async () => {
    t = await createTestApp();
    const res = await t.raw({
      method: 'POST',
      url: '/api/tasks',
      headers: { host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173', 'x-quadro-client': '1' },
      payload: { title: 'via proxy' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('GET sem o header do cliente passa; mutação sem ele é bloqueada', async () => {
    t = await createTestApp();
    expect((await t.raw({ method: 'GET', url: '/api/tasks', headers: { host: '127.0.0.1:3001' } })).statusCode).toBe(200);
    const res = await t.raw({ method: 'POST', url: '/api/tasks', headers: { host: '127.0.0.1:3001' }, payload: { title: 'x' } });
    expect(res.statusCode).toBe(403);
    const wrong = await t.raw({ method: 'POST', url: '/api/tasks', headers: { host: '127.0.0.1:3001', 'x-quadro-client': '0' }, payload: { title: 'x' } });
    expect(wrong.statusCode).toBe(403);
  });

  it('preflight OPTIONS é bloqueado e não traz cabeçalhos CORS', async () => {
    t = await createTestApp();
    const res = await t.raw({
      method: 'OPTIONS',
      url: '/api/tasks',
      headers: {
        host: '127.0.0.1:3001',
        origin: 'http://localhost:8080',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'x-quadro-client',
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('toda rota com método fora de GET/HEAD exige o header do cliente', async () => {
    const temp = createTempDb();
    const routes: Array<{ method: string; url: string }> = [];
    const app = buildApp({
      db: temp.db,
      onRoute: (route: RouteOptions) => {
        const methods = Array.isArray(route.method) ? route.method : [route.method];
        for (const method of methods) routes.push({ method: String(method), url: route.url });
      },
    });
    await app.ready();
    try {
      const mutating = routes.filter((r) => !isSafeMethod(r.method));
      expect(mutating.map((r) => `${r.method} ${r.url}`).sort()).toEqual([
        'DELETE /api/tasks/:id',
        'PATCH /api/tasks/:id',
        'POST /api/board/reset',
        'POST /api/tasks',
        'PUT /api/tasks/:id/position',
      ]);
      for (const route of mutating) {
        const url = route.url.replace(':id', '1');
        const res = await app.inject({
          method: route.method as 'POST',
          url,
          headers: { host: '127.0.0.1:3001' },
          payload: { title: 'x' },
        });
        expect(res.statusCode, `${route.method} ${url}`).toBe(403);
      }
      expect((await app.inject({ method: 'GET', url: '/api/tasks', headers: { host: '127.0.0.1:3001' } })).json()).toEqual({ tasks: [] });
    } finally {
      await app.close();
      temp.cleanup();
    }
  });
});
