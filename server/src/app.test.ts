import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTempDb } from '../test/helpers/tempDb';
import { createTestApp, type TestApp } from '../test/helpers/testApp';
import { API_SECURITY_HEADERS, BODY_LIMIT_BYTES, SAFE_LOG_SERIALIZERS, buildApp, safeLoggerOptions } from './app';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => t.close());

function expectSecurityHeaders(headers: Record<string, unknown>) {
  for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
    expect(headers[name.toLowerCase()], name).toBe(value);
  }
}

describe('buildApp', () => {
  it('limita o corpo a 256 KiB', () => {
    expect(BODY_LIMIT_BYTES).toBe(262_144);
  });

  it('envia os headers de segurança em respostas de sucesso', async () => {
    const res = await t.request('GET', '/api/boards/1/tasks');
    expect(res.statusCode).toBe(200);
    expectSecurityHeaders(res.headers);
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('envia os headers de segurança também no 403 do guard e no 404', async () => {
    const forbidden = await t.raw({ method: 'GET', url: '/api/boards/1/tasks', headers: { host: 'evil.com:3001' } });
    expect(forbidden.statusCode).toBe(403);
    expectSecurityHeaders(forbidden.headers);

    const missing = await t.request('GET', '/api/nada');
    expect(missing.statusCode).toBe(404);
    expectSecurityHeaders(missing.headers);
  });

  it('não instala CORS', async () => {
    const res = await t.raw({
      method: 'GET',
      url: '/api/boards/1/tasks',
      headers: { host: '127.0.0.1:3001', origin: 'http://127.0.0.1:5173', cookie: t.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('o 404 de rota desconhecida também passa pelo guard', async () => {
    const res = await t.raw({ method: 'GET', url: '/qualquer', headers: { host: 'localhost.evil.com:3001' } });
    expect(res.statusCode).toBe(403);
  });
});

describe('log do servidor', () => {
  it('os serializadores guardam só método e caminho (sem query) e só o status da resposta', () => {
    expect(SAFE_LOG_SERIALIZERS.req({ method: 'GET', url: '/api/auth/google/callback?code=abc&state=xyz' })).toEqual({
      method: 'GET',
      url: '/api/auth/google/callback',
    });
    expect(SAFE_LOG_SERIALIZERS.res({ statusCode: 303 })).toEqual({ statusCode: 303 });
    expect(safeLoggerOptions(false)).toBe(false);
  });

  it('numa requisição real, o log não leva query, cookie, e-mail nem corpo', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });
    const temp = createTempDb();
    const app = buildApp({ db: temp.db, logger: { level: 'info', stream }, auth: { devLogin: true } });
    await app.ready();
    try {
      const headers = { host: '127.0.0.1:3001', origin: 'http://127.0.0.1:5173', 'x-quadro-client': '1' };
      const login = await app.inject({ method: 'POST', url: '/api/auth/dev/login', headers, payload: { email: 'segredo.ana@example.com' } });
      expect(login.statusCode).toBe(200);
      const session = login.cookies.find((c) => c.name === 'quadro_session');
      expect(session?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const token = `quadro_session=${session?.value ?? ''}`;
      await app.inject({
        method: 'GET',
        url: '/api/me?code=CODIGO-SECRETO&state=ESTADO-SECRETO&handle=bia_02',
        headers: { host: '127.0.0.1:3001', cookie: token },
      });
      const log = lines.join('\n');
      expect(log).toContain('/api/me');
      for (const secret of ['CODIGO-SECRETO', 'ESTADO-SECRETO', 'bia_02', 'segredo.ana', 'example.com', session?.value ?? '', 'set-cookie']) {
        expect(log, secret).not.toContain(secret);
      }
    } finally {
      await app.close();
      temp.cleanup();
    }
  });
});
