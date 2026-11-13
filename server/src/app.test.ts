import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../test/helpers/testApp';
import { API_SECURITY_HEADERS, BODY_LIMIT_BYTES } from './app';

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
    const res = await t.request('GET', '/api/tasks');
    expect(res.statusCode).toBe(200);
    expectSecurityHeaders(res.headers);
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('envia os headers de segurança também no 403 do guard e no 404', async () => {
    const forbidden = await t.raw({ method: 'GET', url: '/api/tasks', headers: { host: 'evil.com:3001' } });
    expect(forbidden.statusCode).toBe(403);
    expectSecurityHeaders(forbidden.headers);

    const missing = await t.request('GET', '/api/nada');
    expect(missing.statusCode).toBe(404);
    expectSecurityHeaders(missing.headers);
  });

  it('não instala CORS', async () => {
    const res = await t.raw({ method: 'GET', url: '/api/tasks', headers: { host: '127.0.0.1:3001', origin: 'http://127.0.0.1:5173' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('o 404 de rota desconhecida também passa pelo guard', async () => {
    const res = await t.raw({ method: 'GET', url: '/qualquer', headers: { host: 'localhost.evil.com:3001' } });
    expect(res.statusCode).toBe(403);
  });
});
