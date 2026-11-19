import { afterEach, describe, expect, it } from 'vitest';
import { TEST_HOST, createTestApp, type TestApp } from '../../test/helpers/testApp';
import { sessionCookie } from './session';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

describe('sessionCookie', () => {
  it('no 127.0.0.1 (http) o cookie não tem Secure nem o prefixo __Host-', () => {
    expect(sessionCookie(new URL('http://127.0.0.1:5173'))).toEqual({ name: 'quadro_session', secure: false });
  });

  it('no HTTPS (2b) ganha Secure e o prefixo __Host-', () => {
    expect(sessionCookie(new URL('https://quadro.exemplo.com'))).toEqual({ name: '__Host-quadro_session', secure: true });
  });
});

describe('registerSession', () => {
  it('rota comum exige sessão; com sessão, a conta fica na requisição', async () => {
    t = await createTestApp();
    expect((await t.anonymous('GET', '/api/boards/1/tasks')).statusCode).toBe(401);
    expect((await t.request('GET', '/api/boards/1/tasks')).statusCode).toBe(200);
  });

  it('rota pública não exige sessão', async () => {
    t = await createTestApp({ signInAsAdmin: false });
    expect((await t.anonymous('GET', '/api/health')).json()).toEqual({ ok: true });
  });

  it('o cookie vale só pelo nome certo', async () => {
    t = await createTestApp();
    const value = t.cookie.split('=')[1] ?? '';
    const wrongName = await t.raw({ method: 'GET', url: '/api/boards/1/tasks', headers: { host: TEST_HOST, cookie: `__Host-quadro_session=${value}` } });
    expect(wrongName.statusCode).toBe(401);
  });
});
