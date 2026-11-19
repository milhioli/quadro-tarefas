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
    '192.168.0.10:5173',
    '192.168.0.10:3001',
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
  it('aceita ausência só quando não é obrigatória, e as origens exatas do Vite', () => {
    expect(isAllowedOrigin(undefined, DEFAULT_GUARD_OPTIONS)).toBe(true);
    expect(isAllowedOrigin(undefined, DEFAULT_GUARD_OPTIONS, true)).toBe(false);
    expect(isAllowedOrigin('http://127.0.0.1:5173', DEFAULT_GUARD_OPTIONS, true)).toBe(true);
    expect(isAllowedOrigin('http://localhost:5173', DEFAULT_GUARD_OPTIONS)).toBe(true);
  });

  it.each([
    'null',
    'http://localhost:8080',
    'http://127.0.0.1:5173.evil.com',
    'https://127.0.0.1:5173',
    'http://evil.com',
    'http://192.168.0.10:5173',
  ])(
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
  it('acesso pela rede local (IP da máquina) é recusado: só loopback', async () => {
    t = await createTestApp();
    const byHost = await t.raw({ method: 'GET', url: '/api/boards/1/tasks', headers: { host: '192.168.0.10:5173' } });
    expect(byHost.statusCode).toBe(403);
    const byOrigin = await t.raw({
      method: 'GET',
      url: '/api/boards/1/tasks',
      headers: { host: '127.0.0.1:5173', origin: 'http://192.168.0.10:5173' },
    });
    expect(byOrigin.statusCode).toBe(403);
  });

  it.each(['localhost.evil.com:3001', '127.0.0.1.evil.com:3001', 'evil.com'])('Host %s → 403', async (host) => {
    t = await createTestApp();
    const res = await t.raw({ method: 'GET', url: '/api/boards/1/tasks', headers: { host } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: { code: 'FORBIDDEN', message: 'Acesso negado' } });
  });

  it.each(['GET', 'POST'] as const)('Origin estranho e "null" → 403 em %s', async (method) => {
    t = await createTestApp();
    for (const origin of ['http://localhost:8080', 'null']) {
      const res = await t.raw({
        method,
        url: '/api/boards/1/tasks',
        headers: { host: '127.0.0.1:3001', origin, 'x-quadro-client': '1' },
        ...(method === 'POST' ? { payload: { title: 'x' } } : {}),
      });
      expect(res.statusCode).toBe(403);
    }
    expect((await t.request('GET', '/api/boards/1/tasks')).json()).toEqual({ tasks: [] });
  });

  it('Origin do Vite passa', async () => {
    t = await createTestApp();
    const res = await t.raw({
      method: 'POST',
      url: '/api/boards/1/tasks',
      headers: { host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173', 'x-quadro-client': '1', cookie: t.cookie },
      payload: { title: 'via proxy' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('mutação sem Origin é bloqueada, mesmo com o header do cliente; GET sem Origin passa', async () => {
    t = await createTestApp();
    const res = await t.raw({
      method: 'POST',
      url: '/api/boards/1/tasks',
      headers: { host: '127.0.0.1:3001', 'x-quadro-client': '1' },
      payload: { title: 'x' },
    });
    expect(res.statusCode).toBe(403);
    expect((await t.raw({ method: 'GET', url: '/api/boards/1/tasks', headers: { host: '127.0.0.1:3001', cookie: t.cookie } })).statusCode).toBe(200);
  });

  it('GET sem o header do cliente passa; mutação sem ele é bloqueada', async () => {
    t = await createTestApp();
    expect((await t.raw({ method: 'GET', url: '/api/boards/1/tasks', headers: { host: '127.0.0.1:3001', cookie: t.cookie } })).statusCode).toBe(200);
    const res = await t.raw({ method: 'POST', url: '/api/boards/1/tasks', headers: { host: '127.0.0.1:3001' }, payload: { title: 'x' } });
    expect(res.statusCode).toBe(403);
    const wrong = await t.raw({ method: 'POST', url: '/api/boards/1/tasks', headers: { host: '127.0.0.1:3001', 'x-quadro-client': '0' }, payload: { title: 'x' } });
    expect(wrong.statusCode).toBe(403);
  });

  it('preflight OPTIONS é bloqueado e não traz cabeçalhos CORS', async () => {
    t = await createTestApp();
    const res = await t.raw({
      method: 'OPTIONS',
      url: '/api/boards/1/tasks',
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
        'DELETE /api/boards/:boardId',
        'DELETE /api/boards/:boardId/members/:userId',
        'DELETE /api/tasks/:id',
        'PATCH /api/boards/:boardId',
        'PATCH /api/tasks/:id',
        'POST /api/auth/logout',
        'POST /api/boards',
        'POST /api/boards/:boardId/invites',
        'POST /api/boards/:boardId/reset',
        'POST /api/boards/:boardId/tasks',
        'POST /api/invites/:boardId/accept',
        'POST /api/invites/:boardId/decline',
        'POST /api/me/profile',
        'PUT /api/tasks/:id/position',
      ]);
      for (const route of mutating) {
        const url = route.url.replace(/:[a-zA-Z]+/g, '1');
        const res = await app.inject({
          method: route.method as 'POST',
          url,
          headers: { host: '127.0.0.1:3001' },
          payload: { title: 'x' },
        });
        expect(res.statusCode, `${route.method} ${url}`).toBe(403);
      }
      // Sem o login de desenvolvimento, a rota dele nem existe.
      const devLogin = await app.inject({
        method: 'POST',
        url: '/api/auth/dev/login',
        headers: { host: '127.0.0.1:3001', origin: 'http://127.0.0.1:5173', 'x-quadro-client': '1' },
        payload: { email: 'admin@example.com' },
      });
      expect(devLogin.statusCode).not.toBe(200);
      expect(routes.some((r) => r.url.startsWith('/api/auth/dev'))).toBe(false);
    } finally {
      await app.close();
      temp.cleanup();
    }
  });
});

describe('negação por padrão (sessão)', () => {
  /** A lista pública é fechada: uma rota nova sem sessão precisa entrar aqui de propósito. */
  const PUBLIC_ROUTES = [
    'GET /api/auth/google/callback',
    'GET /api/auth/google/start',
    'GET /api/auth/methods',
    'GET /api/health',
    'GET /api/me',
    'POST /api/auth/dev/login',
  ];

  it('toda rota fora da lista pública responde 401 sem sessão', async () => {
    const temp = createTempDb();
    const routes: Array<{ method: string; url: string; isPublic: boolean }> = [];
    const app = buildApp({
      db: temp.db,
      auth: { devLogin: true },
      onRoute: (route: RouteOptions) => {
        const methods = Array.isArray(route.method) ? route.method : [route.method];
        const config = (route.config ?? {}) as { public?: boolean };
        for (const method of methods) routes.push({ method: String(method), url: route.url, isPublic: config.public === true });
      },
    });
    await app.ready();
    try {
      const declared = routes.filter((r) => r.method !== 'HEAD');
      expect(declared.filter((r) => r.isPublic).map((r) => `${r.method} ${r.url}`).sort()).toEqual(PUBLIC_ROUTES);
      for (const route of declared.filter((r) => !r.isPublic)) {
        const url = route.url.replace(/:[a-zA-Z]+/g, '1');
        const unsafe = !isSafeMethod(route.method);
        const res = await app.inject({
          method: route.method as 'GET',
          url: route.url.includes('calendar') ? `${url}?week=2026-11-16` : url,
          headers: {
            host: '127.0.0.1:3001',
            'x-quadro-client': '1',
            ...(unsafe ? { origin: 'http://127.0.0.1:5173' } : {}),
          },
          ...(unsafe ? { payload: {} } : {}),
        });
        expect(res.statusCode, `${route.method} ${url}`).toBe(401);
        expect(res.json()).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Entre para continuar' } });
      }
      // Rota desconhecida também não vaza nada sem sessão.
      expect((await app.inject({ method: 'GET', url: '/api/nada', headers: { host: '127.0.0.1:3001' } })).statusCode).toBe(401);
    } finally {
      await app.close();
      temp.cleanup();
    }
  });

  it('cookie válido com Origin de outro projeto local (outra porta) dá 403', async () => {
    t = await createTestApp();
    for (const method of ['GET', 'POST'] as const) {
      const res = await t.raw({
        method,
        url: '/api/boards/1/tasks',
        headers: { host: '127.0.0.1:3001', origin: 'http://127.0.0.1:3000', cookie: t.cookie, 'x-quadro-client': '1' },
        ...(method === 'POST' ? { payload: { title: 'x' } } : {}),
      });
      expect(res.statusCode, method).toBe(403);
    }
  });
});
