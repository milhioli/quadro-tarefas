import { Writable } from 'node:stream';
import type { MeResponse } from '@quadro/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { FAKE_AUTHORIZATION_ENDPOINT, createFakeIdentity, fakeClaims, type FakeIdentity } from '../../test/helpers/fakeIdentity';
import { createTempDb } from '../../test/helpers/tempDb';
import {
  ADMIN_EMAIL,
  SESSION_COOKIE,
  T0,
  TEST_HOST,
  TEST_ORIGIN,
  createTestApp,
  type CreateTestAppOptions,
  type TestApp,
} from '../../test/helpers/testApp';
import { buildApp } from '../app';
import { IdentityError, type IdentityClaims } from '../auth/identity';
import { PENDING_LOGIN_TTL_MS, createPendingLogins } from '../auth/pendingLogins';
import { fixedNow } from '../clock';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const MUTATION = { host: TEST_HOST, origin: TEST_ORIGIN, 'x-quadro-client': '1' };

async function devLogin(app: TestApp, email: string) {
  const res = await app.raw({ method: 'POST', url: '/api/auth/dev/login', headers: MUTATION, payload: { email } });
  const session = res.cookies.find((c) => c.name === SESSION_COOKIE);
  return { res, cookie: session ? `${SESSION_COOKIE}=${session.value}` : '', session };
}

describe('métodos de login', () => {
  it('sem provedor Google: só o de desenvolvimento (nos testes)', async () => {
    t = await createTestApp({ signInAsAdmin: false });
    expect((await t.anonymous('GET', '/api/auth/methods')).json()).toEqual({ google: false, dev: true });
  });
});

describe('login de desenvolvimento e /api/me', () => {
  it('sem sessão, /api/me responde 200 com user null (não 401)', async () => {
    t = await createTestApp({ signInAsAdmin: false });
    const res = await t.anonymous('GET', '/api/me');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ user: null, pendingProfile: null });
  });

  it('entrar emite um cookie de sessão HttpOnly e SameSite=Lax, e a conta começa sem perfil', async () => {
    t = await createTestApp({ signInAsAdmin: false });
    const { res, session, cookie } = await devLogin(t, 'ana.souza@example.com');
    expect(res.statusCode).toBe(200);
    expect(session).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(session?.secure).toBeFalsy();
    expect(res.json()).toEqual({ user: null, pendingProfile: { suggestedName: 'ana.souza' } });
    const me = await t.raw({ method: 'GET', url: '/api/me', headers: { host: TEST_HOST, cookie } });
    expect((me.json() as MeResponse).pendingProfile).toEqual({ suggestedName: 'ana.souza' });
  });

  it('sem perfil, só as rotas de primeiro acesso: o resto responde 403 NEEDS_USERNAME', async () => {
    t = await createTestApp({ signInAsAdmin: false });
    const { cookie } = await devLogin(t, 'ana@example.com');
    const res = await t.raw({ method: 'GET', url: '/api/boards/1/tasks', headers: { host: TEST_HOST, cookie } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'NEEDS_USERNAME' } });
  });

  it('criar o perfil dá o handle e o quadro pessoal; o admin fica com o _00 e o quadro legado', async () => {
    t = await createTestApp({ signInAsAdmin: false });
    const ana = await t.signIn('ana@example.com', { username: 'ana', displayName: 'Ana' });
    const admin = await t.signIn(ADMIN_EMAIL, { username: 'chefe', displayName: 'Chefe' });
    expect(ana.handle).toBe('ana_01');
    expect(admin.handle).toBe('chefe_00');
    expect(admin.boardId).toBe(1);
    expect(ana.boardId).not.toBe(1);
    const me = (await admin.request('GET', '/api/me')).json() as MeResponse;
    expect(me.user).toEqual({ id: admin.userId, handle: 'chefe_00', displayName: 'Chefe', role: 'admin', personalBoardId: 1 });
  });

  it('o perfil valida o nome e recusa campos extras e segunda criação', async () => {
    t = await createTestApp({ signInAsAdmin: false });
    const { cookie } = await devLogin(t, 'ana@example.com');
    const send = (payload: unknown) =>
      t!.raw({ method: 'POST', url: '/api/me/profile', headers: { ...MUTATION, cookie }, payload: payload as object });
    expect((await send({ username: 'admin', displayName: 'Ana' })).statusCode).toBe(400);
    expect((await send({ username: 'ana', displayName: 'Ana‮' })).statusCode).toBe(400);
    expect((await send({ username: 'ana', displayName: 'Ana', role: 'admin' })).statusCode).toBe(400);
    expect((await send({ username: 'ana', displayName: 'Ana', seq: 0 })).statusCode).toBe(400);
    expect((await send({ username: 'ana', displayName: 'Ana' })).statusCode).toBe(200);
    expect((await send({ username: 'ana', displayName: 'Ana' })).statusCode).toBe(409);
  });

  it('o login de desenvolvimento aceita só e-mails @example.com e nada além do e-mail', async () => {
    t = await createTestApp({ signInAsAdmin: false });
    for (const payload of [{ email: 'ana@gmail.com' }, { email: 'ana@example.com', role: 'admin' }, { email: 'x@example.com', seq: 0 }]) {
      const res = await t.raw({ method: 'POST', url: '/api/auth/dev/login', headers: MUTATION, payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it('cada login emite uma sessão nova e apaga a anterior do cookie', async () => {
    t = await createTestApp({ signInAsAdmin: false });
    const first = await devLogin(t, 'ana@example.com');
    const second = await t.raw({
      method: 'POST',
      url: '/api/auth/dev/login',
      headers: { ...MUTATION, cookie: first.cookie },
      payload: { email: 'ana@example.com' },
    });
    const next = second.cookies.find((c) => c.name === SESSION_COOKIE);
    expect(next?.value).not.toBe(first.session?.value);
    const old = await t.raw({ method: 'GET', url: '/api/me', headers: { host: TEST_HOST, cookie: first.cookie } });
    expect(old.json()).toEqual({ user: null, pendingProfile: null });
  });
});

describe('sessão', () => {
  it('logout apaga a sessão e limpa o cookie', async () => {
    t = await createTestApp();
    const res = await t.request('POST', '/api/auth/logout');
    expect(res.statusCode).toBe(204);
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)?.value).toBe('');
    expect((await t.request('GET', '/api/boards/1/tasks')).statusCode).toBe(401);
  });

  it('conta desativada não entra de novo e perde a sessão na hora', async () => {
    t = await createTestApp({ signInAsAdmin: false });
    const ana = await t.signIn('ana@example.com', { username: 'ana', displayName: 'Ana' });
    t.temp.db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(ana.userId);
    expect((await ana.request('GET', '/api/boards/1/tasks')).statusCode).toBe(401);
    const again = await devLogin(t, 'ana@example.com');
    expect(again.res.statusCode).toBe(403);
    expect(again.session).toBeUndefined();
  });

  it('a sessão de uma conta dev: não vale num servidor sem o login de desenvolvimento', async () => {
    t = await createTestApp();
    const normal = buildApp({ db: t.temp.db, now: fixedNow('2026-11-13T12:00:00.000Z'), auth: { devLogin: false } });
    await normal.ready();
    try {
      const res = await normal.inject({ method: 'GET', url: '/api/boards/1/tasks', headers: { host: TEST_HOST, cookie: t.cookie } });
      expect(res.statusCode).toBe(401);
      const me = await normal.inject({ method: 'GET', url: '/api/me', headers: { host: TEST_HOST, cookie: t.cookie } });
      expect(me.json()).toEqual({ user: null, pendingProfile: null });
    } finally {
      await normal.close();
    }
  });

  it('cookie forjado ou de outra pessoa não resolve', async () => {
    t = await createTestApp();
    for (const cookie of [`${SESSION_COOKIE}=${'a'.repeat(43)}`, `${SESSION_COOKIE}=../../etc`, 'outro=1']) {
      expect((await t.raw({ method: 'GET', url: '/api/boards/1/tasks', headers: { host: TEST_HOST, cookie } })).statusCode).toBe(401);
    }
  });

  it('o audit_log registra login e criação de perfil, sem e-mail', async () => {
    t = await createTestApp({ signInAsAdmin: false });
    await t.signIn('ana@example.com', { username: 'ana', displayName: 'Ana' });
    const rows = t.temp.db.prepare('SELECT action, target_kind FROM audit_log ORDER BY id').all();
    expect(rows).toEqual([
      { action: 'login', target_kind: 'user' },
      { action: 'profile.create', target_kind: 'user' },
    ]);
    expect(JSON.stringify(t.temp.db.prepare('SELECT * FROM audit_log').all())).not.toContain('example.com');
  });
});

/** Host do app (Vite): o navegador chega à API pelo proxy, com o Host do APP_ORIGIN. */
const APP_HOST = '127.0.0.1:5173';
const APP = 'http://127.0.0.1:5173';
const OAUTH_COOKIE = 'quadro_oauth';
const NAVIGATION = { host: APP_HOST, 'sec-fetch-site': 'same-origin' };

async function googleApp(fake: FakeIdentity, options: CreateTestAppOptions = {}) {
  return createTestApp({ signInAsAdmin: false, ...options, auth: { identity: fake, ...options.auth } });
}

async function startGoogle(app: TestApp, query = '', headers: Record<string, string> = NAVIGATION) {
  const res = await app.raw({ method: 'GET', url: `/api/auth/google/start${query}`, headers });
  const oauth = res.cookies.find((c) => c.name === OAUTH_COOKIE);
  return { res, oauth, cookie: oauth ? `${OAUTH_COOKIE}=${oauth.value}` : '' };
}

async function callbackGoogle(app: TestApp, query: string, cookie: string, host = APP_HOST) {
  const res = await app.raw({
    method: 'GET',
    url: `/api/auth/google/callback${query}`,
    headers: cookie ? { host, cookie } : { host },
  });
  const session = res.cookies.find((c) => c.name === SESSION_COOKIE && c.value !== '');
  return { res, session, cookie: session ? `${SESSION_COOKIE}=${session.value}` : '' };
}

/** Start e volta do Google com o state certo. */
async function googleLogin(app: TestApp, fake: FakeIdentity, options: { next?: string; extraCookie?: string } = {}) {
  const start = await startGoogle(app, options.next === undefined ? '' : `?next=${encodeURIComponent(options.next)}`);
  const state = fake.begun.at(-1)?.checks.state ?? '';
  const cookie = [start.cookie, options.extraCookie].filter(Boolean).join('; ');
  return { start, ...(await callbackGoogle(app, `?code=codigo-1&state=${state}&scope=openid`, cookie)) };
}

const countUsers = (app: TestApp) => (app.temp.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;

function expectFailure(res: { statusCode: number; headers: Record<string, unknown>; cookies: Array<{ name: string; value: string }> }, outcome = 'erro') {
  expect(res.statusCode).toBe(303);
  expect(res.headers.location).toBe(`${APP}/?login=${outcome}`);
  expect(res.cookies.filter((c) => c.name === SESSION_COOKIE && c.value !== '')).toEqual([]);
}

describe('login Google: início', () => {
  it('métodos: google true com o provedor pronto, false quando indisponível', async () => {
    const fake = createFakeIdentity();
    t = await googleApp(fake);
    expect((await t.anonymous('GET', '/api/auth/methods')).json()).toEqual({ google: true, dev: true });
    fake.ready = false;
    expect((await t.anonymous('GET', '/api/auth/methods')).json()).toEqual({ google: false, dev: true });
  });

  it('manda ao Google com o redirect_uri do APP_ORIGIN; o navegador guarda só um id aleatório', async () => {
    const fake = createFakeIdentity();
    t = await googleApp(fake);
    const { res, oauth } = await startGoogle(t);
    expect(res.statusCode).toBe(303);
    expect(String(res.headers.location).startsWith(`${FAKE_AUTHORIZATION_ENDPOINT}?`)).toBe(true);
    expect(fake.begun).toHaveLength(1);
    expect(fake.begun[0]?.redirectUri).toBe(`${APP}/api/auth/google/callback`);
    expect(oauth).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/api/auth', maxAge: 600 });
    expect(oauth?.secure).toBeFalsy();
    expect(oauth?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const checks = fake.begun[0]?.checks;
    for (const secret of [checks?.state, checks?.nonce, checks?.codeVerifier]) expect(oauth?.value).not.toContain(secret);
    expect(res.cookies.map((c) => c.name)).toEqual([OAUTH_COOKIE]);
  });

  it.each([
    ['cross-site', { 'sec-fetch-site': 'cross-site' }],
    ['same-site', { 'sec-fetch-site': 'same-site' }],
    ['sem Sec-Fetch-Site', {}],
  ])('navegação %s: volta com erro, sem cookie e sem chamar o provedor', async (_label, extra) => {
    const fake = createFakeIdentity();
    t = await googleApp(fake);
    const { res } = await startGoogle(t, '', { host: APP_HOST, ...extra });
    expectFailure(res);
    expect(res.cookies).toEqual([]);
    expect(fake.begun).toEqual([]);
  });

  it('em outro host, volta para a raiz do APP_ORIGIN sem começar o login', async () => {
    const fake = createFakeIdentity();
    t = await googleApp(fake);
    const { res } = await startGoogle(t, '', { host: 'localhost:5173', 'sec-fetch-site': 'same-origin' });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe(`${APP}/`);
    expect(res.cookies).toEqual([]);
    expect(fake.begun).toEqual([]);
  });

  it('provedor indisponível: volta com login=indisponivel', async () => {
    const fake = createFakeIdentity();
    fake.ready = false;
    t = await googleApp(fake);
    const { res } = await startGoogle(t);
    expectFailure(res, 'indisponivel');
    expect(res.cookies).toEqual([]);
  });

  it('com o teto de logins em andamento cheio, recusa o login novo', async () => {
    const fake = createFakeIdentity();
    t = await googleApp(fake, { auth: { pendingLogins: createPendingLogins(fixedNow(T0), { max: 1 }) } });
    expect((await startGoogle(t)).res.statusCode).toBe(303);
    const { res } = await startGoogle(t);
    expectFailure(res);
    expect(res.cookies).toEqual([]);
  });
});

describe('login Google: volta', () => {
  it('abre a sessão, limpa o cookie do login, volta para / e sugere o given_name no primeiro acesso', async () => {
    const fake = createFakeIdentity();
    t = await googleApp(fake);
    const { res, session, cookie } = await googleLogin(t, fake);
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe(`${APP}/`);
    expect(session).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(res.cookies.find((c) => c.name === OAUTH_COOKIE)).toMatchObject({ value: '', path: '/api/auth' });

    const state = fake.begun[0]?.checks.state;
    expect(fake.completed[0]?.callbackUrl.href).toBe(`${APP}/api/auth/google/callback?code=codigo-1&state=${state}&scope=openid`);
    expect(fake.completed[0]?.checks).toEqual(fake.begun[0]?.checks);

    const me = await t.raw({ method: 'GET', url: '/api/me', headers: { host: TEST_HOST, cookie } });
    expect(me.json()).toEqual({ user: null, pendingProfile: { suggestedName: 'Ana' } });
    const profile = await t.raw({
      method: 'POST',
      url: '/api/me/profile',
      headers: { ...MUTATION, cookie },
      payload: { username: 'ana', displayName: 'Ana' },
    });
    expect((profile.json() as MeResponse).user?.handle).toBe('ana_01');
    expect(t.temp.db.prepare('SELECT google_sub, email FROM users').all()).toEqual([
      { google_sub: '109876543210', email: 'ana@example.com' },
    ]);
  });

  it('a URL de volta passada ao provedor sai do APP_ORIGIN, mesmo com outro Host', async () => {
    const fake = createFakeIdentity();
    t = await googleApp(fake);
    const start = await startGoogle(t);
    const state = fake.begun[0]?.checks.state ?? '';
    const { res } = await callbackGoogle(t, `?code=c&state=${state}`, start.cookie, 'localhost:3001');
    expect(fake.completed[0]?.callbackUrl.origin).toBe(APP);
    expect(res.headers.location).toBe(`${APP}/`);
  });

  it('volta para o next pedido; destino aberto vira /', async () => {
    const fake = createFakeIdentity();
    t = await googleApp(fake);
    expect((await googleLogin(t, fake, { next: '/?board=3' })).res.headers.location).toBe(`${APP}/?board=3`);
    expect((await googleLogin(t, fake, { next: '//evil.com' })).res.headers.location).toBe(`${APP}/`);
    expect((await googleLogin(t, fake, { next: 'https://evil.com/' })).res.headers.location).toBe(`${APP}/`);
  });

  it('o mesmo sub entra na mesma conta; cada login é uma sessão nova e apaga a anterior do cookie', async () => {
    const fake = createFakeIdentity();
    t = await googleApp(fake);
    const first = await googleLogin(t, fake);
    const second = await googleLogin(t, fake, { extraCookie: first.cookie });
    expect(second.session?.value).not.toBe(first.session?.value);
    expect(countUsers(t)).toBe(1);
    const old = await t.raw({ method: 'GET', url: '/api/me', headers: { host: TEST_HOST, cookie: first.cookie } });
    expect(old.json()).toEqual({ user: null, pendingProfile: null });
  });

  it.each<[string, (state: string) => string, (startCookie: string) => string]>([
    ['sem o cookie do login', (state) => `?code=c&state=${state}`, () => ''],
    ['com o id de um login que não existe', (state) => `?code=c&state=${state}`, () => `${OAUTH_COOKIE}=${'a'.repeat(43)}`],
    ['com o state de outro login', () => '?code=c&state=outro', (cookie) => cookie],
    ['com o state repetido', (state) => `?code=c&state=${state}&state=${state}`, (cookie) => cookie],
    ['sem state', () => '?code=c', (cookie) => cookie],
  ])('%s: volta com erro, sem sessão e sem chamar o provedor', async (_label, query, cookieFor) => {
    const fake = createFakeIdentity();
    t = await googleApp(fake);
    const start = await startGoogle(t);
    const state = fake.begun[0]?.checks.state ?? '';
    const { res } = await callbackGoogle(t, query(state), cookieFor(start.cookie));
    expectFailure(res);
    expect(fake.completed).toEqual([]);
    expect(countUsers(t)).toBe(0);
  });

  it('o login é de uso único: depois de uma volta (com sucesso ou não), o mesmo cookie e state não valem', async () => {
    const fake = createFakeIdentity();
    t = await googleApp(fake);
    const ok = await googleLogin(t, fake);
    const state = fake.begun[0]?.checks.state ?? '';
    expect(ok.session).toBeDefined();
    expectFailure((await callbackGoogle(t, `?code=codigo-1&state=${state}`, ok.start.cookie)).res);

    const start = await startGoogle(t);
    const second = fake.begun[1]?.checks.state ?? '';
    expectFailure((await callbackGoogle(t, '?code=c&state=errado', start.cookie)).res);
    expectFailure((await callbackGoogle(t, `?code=c&state=${second}`, start.cookie)).res);
    expect(fake.completed).toHaveLength(1);
  });

  it('o login em andamento expira em 10 minutos', async () => {
    let time = Date.parse(T0);
    const fake = createFakeIdentity();
    t = await googleApp(fake, { auth: { pendingLogins: createPendingLogins(() => new Date(time)) } });
    const start = await startGoogle(t);
    time += PENDING_LOGIN_TTL_MS;
    const state = fake.begun[0]?.checks.state ?? '';
    expectFailure((await callbackGoogle(t, `?code=c&state=${state}`, start.cookie)).res);
    expect(fake.completed).toEqual([]);
  });

  it('a pessoa cancelou no Google (error=access_denied): login=cancelado, sem trocar o code', async () => {
    const fake = createFakeIdentity();
    t = await googleApp(fake);
    const start = await startGoogle(t);
    const state = fake.begun[0]?.checks.state ?? '';
    expectFailure((await callbackGoogle(t, `?error=access_denied&state=${state}`, start.cookie)).res, 'cancelado');
    expect(fake.completed).toEqual([]);
  });

  it.each<[string, () => IdentityClaims | IdentityError]>([
    ['e-mail não verificado', () => fakeClaims({ emailVerified: false })],
    ['sub com o prefixo dev:', () => fakeClaims({ sub: 'dev:ana@example.com' })],
    ['provedor recusou o token', () => new IdentityError('rejected')],
    ['claims inválidas', () => new IdentityError('invalid-claims')],
  ])('%s: volta com erro, sem sessão e sem conta criada', async (_label, result) => {
    const fake = createFakeIdentity(result());
    t = await googleApp(fake);
    const { res } = await googleLogin(t, fake);
    expectFailure(res);
    expect(fake.completed).toHaveLength(1);
    expect(countUsers(t)).toBe(0);
  });

  it('provedor ficou indisponível entre o início e a volta: login=indisponivel', async () => {
    const fake = createFakeIdentity();
    t = await googleApp(fake);
    const start = await startGoogle(t);
    fake.ready = false;
    const state = fake.begun[0]?.checks.state ?? '';
    expectFailure((await callbackGoogle(t, `?code=c&state=${state}`, start.cookie)).res, 'indisponivel');
  });

  it('conta desativada não entra', async () => {
    const fake = createFakeIdentity();
    t = await googleApp(fake);
    await googleLogin(t, fake);
    t.temp.db.prepare("UPDATE users SET status = 'disabled'").run();
    expectFailure((await googleLogin(t, fake)).res);
  });

  it('a conta do e-mail do admin vira _00 com o quadro legado ao criar o perfil', async () => {
    const fake = createFakeIdentity(fakeClaims({ sub: 'sub-do-admin', email: ADMIN_EMAIL, givenName: 'Chefe' }));
    t = await googleApp(fake);
    const { cookie } = await googleLogin(t, fake);
    const profile = await t.raw({
      method: 'POST',
      url: '/api/me/profile',
      headers: { ...MUTATION, cookie },
      payload: { username: 'chefe', displayName: 'Chefe' },
    });
    expect((profile.json() as MeResponse).user).toMatchObject({ handle: 'chefe_00', role: 'admin', personalBoardId: 1 });
  });
});

describe('login Google: log', () => {
  it('o log do start e da volta não leva code, state, e-mail, sub, nem os cookies', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });
    const temp = createTempDb();
    const fake = createFakeIdentity(fakeClaims({ sub: 'SUB-SECRETO', email: 'segredo.ana@example.com' }));
    const app = buildApp({ db: temp.db, logger: { level: 'info', stream }, auth: { identity: fake } });
    await app.ready();
    try {
      const start = await app.inject({ method: 'GET', url: '/api/auth/google/start', headers: NAVIGATION });
      const oauth = start.cookies.find((c) => c.name === OAUTH_COOKIE)?.value ?? '';
      const state = fake.begun[0]?.checks.state ?? '';
      const back = await app.inject({
        method: 'GET',
        url: `/api/auth/google/callback?code=CODIGO-SECRETO&state=${state}`,
        headers: { host: APP_HOST, cookie: `${OAUTH_COOKIE}=${oauth}` },
      });
      const session = back.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? '';
      expect(session).not.toBe('');
      // Uma volta recusada também loga só o tipo.
      await app.inject({ method: 'GET', url: '/api/auth/google/callback?code=OUTRO-CODIGO&state=x', headers: { host: APP_HOST } });
      const log = lines.join('\n');
      expect(log).toContain('/api/auth/google/callback');
      expect(log).toContain('no-pending');
      for (const secret of ['CODIGO-SECRETO', 'OUTRO-CODIGO', state, oauth, session, 'SUB-SECRETO', 'segredo.ana', 'example.com', 'set-cookie']) {
        expect(log, secret).not.toContain(secret);
      }
    } finally {
      await app.close();
      temp.cleanup();
    }
  });
});
