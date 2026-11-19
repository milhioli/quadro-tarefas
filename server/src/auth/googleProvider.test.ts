import { createHash, createHmac, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { CalendarFetchError, createOidcFetch, type FetchImpl } from '../calendar/guardedFetch';
import { systemNow } from '../clock';
import { DISCOVERY_RETRY_MS, GOOGLE_ISSUER, createGoogleProvider, discoveryErrorKind, type DiscoveryErrorKind } from './googleProvider';
import { IdentityError, type LoginChecks } from './identity';

// Tudo aqui é escrito à mão: nenhuma resposta real do Google, nenhuma chave real.
const CLIENT_ID = '123-teste.apps.googleusercontent.com';
const SECRET = 'segredo-de-teste-XYZ';
const REDIRECT_URI = 'http://127.0.0.1:5173/api/auth/google/callback';
const KID = 'chave-teste-1';

const realKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 });

const DISCOVERY = {
  issuer: GOOGLE_ISSUER,
  authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  token_endpoint: 'https://oauth2.googleapis.com/token',
  jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
  response_types_supported: ['code'],
  subject_types_supported: ['public'],
  id_token_signing_alg_values_supported: ['RS256'],
  scopes_supported: ['openid', 'email', 'profile'],
  token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
  code_challenge_methods_supported: ['plain', 'S256'],
};

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

function signJwt(claims: object, privateKey: KeyObject = realKey.privateKey, header: object = { alg: 'RS256', kid: KID, typ: 'JWT' }) {
  const input = `${b64url(header)}.${b64url(claims)}`;
  return `${input}.${sign('sha256', Buffer.from(input), privateKey).toString('base64url')}`;
}

// O openid-client confere iat/exp contra o relógio real: os tempos saem de systemNow().
const nowSeconds = () => Math.floor(systemNow().getTime() / 1000);

function idClaims(nonce: string, overrides: object = {}) {
  const iat = nowSeconds();
  return {
    iss: GOOGLE_ISSUER,
    aud: CLIENT_ID,
    azp: CLIENT_ID,
    sub: '109876543210',
    email: 'Ana.Souza@Example.com',
    email_verified: true,
    given_name: 'Ana',
    name: 'Ana Souza',
    iat,
    exp: iat + 3600,
    nonce,
    ...overrides,
  };
}

interface Seen {
  url: string;
  method: string;
  body: string;
}

function fakeGoogle(discovery: object = DISCOVERY) {
  const seen: Seen[] = [];
  const state = { idToken: '', down: false, tokenStatus: 200 };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const network: FetchImpl = async (input, init) => {
    seen.push({ url: input, method: init.method ?? 'GET', body: init.body == null ? '' : String(init.body) });
    if (state.down) throw new TypeError('fetch failed');
    if (input === `${GOOGLE_ISSUER}/.well-known/openid-configuration`) return json(discovery);
    if (input === DISCOVERY.jwks_uri) {
      return json({ keys: [{ ...realKey.publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' }] });
    }
    if (input === DISCOVERY.token_endpoint) {
      if (state.tokenStatus !== 200) return json({ error: 'invalid_grant' }, state.tokenStatus);
      return json({ access_token: 'token-de-acesso', token_type: 'Bearer', expires_in: 3599, scope: 'openid email profile', id_token: state.idToken });
    }
    return json({ error: 'not_found' }, 404);
  };
  return { seen, state, fetch: createOidcFetch({ fetch: network }) };
}

function clock(iso = '2026-11-18T12:00:00.000Z') {
  let time = Date.parse(iso);
  return {
    now: () => new Date(time),
    advance(ms: number) {
      time += ms;
    },
  };
}

function provider(google = fakeGoogle(), c = clock(), onDiscoveryError?: (kind: DiscoveryErrorKind) => void) {
  return createGoogleProvider({ google: { clientId: CLIENT_ID, clientSecret: () => SECRET }, now: c.now, fetch: google.fetch, onDiscoveryError });
}

const callback = (checks: LoginChecks, state = checks.state) => new URL(`${REDIRECT_URI}?code=codigo-123&state=${state}&scope=openid`);

async function rejection(promise: Promise<unknown>): Promise<IdentityError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(IdentityError);
  return error as IdentityError;
}

let globalFetch: MockInstance<typeof fetch>;
beforeEach(() => {
  globalFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('rede real proibida nos testes'));
});
afterEach(() => {
  expect(globalFetch).not.toHaveBeenCalled();
  globalFetch.mockRestore();
});

describe('createGoogleProvider: login completo', () => {
  it('discovery, URL de autorização com PKCE S256, troca do code e ID token conferido pelo JWKS', async () => {
    const google = fakeGoogle();
    const p = provider(google);
    expect(p.available()).toBe(false);
    expect(await p.init()).toBe(true);
    expect(p.available()).toBe(true);

    const { authorizationUrl, checks } = await p.begin(REDIRECT_URI);
    expect(`${authorizationUrl.origin}${authorizationUrl.pathname}`).toBe(DISCOVERY.authorization_endpoint);
    const params = authorizationUrl.searchParams;
    expect(Object.fromEntries(params)).toEqual({
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      scope: 'openid email profile',
      code_challenge: createHash('sha256').update(checks.codeVerifier).digest('base64url'),
      code_challenge_method: 'S256',
      state: checks.state,
      nonce: checks.nonce,
      prompt: 'select_account',
    });
    expect(authorizationUrl.href).not.toContain(SECRET);
    expect(new Set([checks.state, checks.nonce, checks.codeVerifier]).size).toBe(3);

    google.state.idToken = signJwt(idClaims(checks.nonce));
    const claims = await p.complete(callback(checks), checks);
    // Só o que o app usa; o nome completo e o resto do token não saem daqui.
    expect(claims).toEqual({ sub: '109876543210', email: 'ana.souza@example.com', emailVerified: true, givenName: 'Ana' });

    const token = google.seen.find((r) => r.url === DISCOVERY.token_endpoint);
    expect(token?.method).toBe('POST');
    const body = new URLSearchParams(token?.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('codigo-123');
    expect(body.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(body.get('code_verifier')).toBe(checks.codeVerifier);
    expect(body.get('client_id')).toBe(CLIENT_ID);
    expect(body.get('client_secret')).toBe(SECRET);
    expect(google.seen.map((r) => r.url)).toEqual([
      `${GOOGLE_ISSUER}/.well-known/openid-configuration`,
      DISCOVERY.token_endpoint,
      DISCOVERY.jwks_uri,
    ]);
  });

  it('email_verified falso passa adiante como falso (quem recusa é a rota)', async () => {
    const google = fakeGoogle();
    const p = provider(google);
    await p.init();
    const { checks } = await p.begin(REDIRECT_URI);
    google.state.idToken = signJwt(idClaims(checks.nonce, { email_verified: false, given_name: undefined }));
    expect(await p.complete(callback(checks), checks)).toMatchObject({ emailVerified: false, givenName: null });
  });

  it('o segredo não aparece ao inspecionar o provider', async () => {
    const google = fakeGoogle();
    const p = provider(google);
    await p.init();
    const { checks } = await p.begin(REDIRECT_URI);
    google.state.idToken = signJwt(idClaims(checks.nonce));
    await p.complete(callback(checks), checks);
    expect(inspect(p, { showHidden: true, depth: Infinity })).not.toContain(SECRET);
    expect(JSON.stringify(p)).not.toContain(SECRET);
  });
});

describe('createGoogleProvider: ID token recusado', () => {
  const cases: [string, (nonce: string) => string][] = [
    ['assinado por outra chave', (nonce) => signJwt(idClaims(nonce), otherKey.privateKey)],
    ['com o nonce de outro login', () => signJwt(idClaims('nonce-de-outro-login'))],
    ['emitido para outro cliente', (nonce) => signJwt(idClaims(nonce, { aud: 'outro-cliente', azp: 'outro-cliente' }))],
    ['de outro emissor', (nonce) => signJwt(idClaims(nonce, { iss: 'https://evil.example.com' }))],
    ['expirado', (nonce) => signJwt(idClaims(nonce, { iat: nowSeconds() - 7200, exp: nowSeconds() - 3600 }))],
    ['sem assinatura (alg none)', (nonce) => `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(idClaims(nonce))}.`],
    [
      'HS256 assinado com o segredo do cliente',
      (nonce) => {
        const input = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(idClaims(nonce))}`;
        return `${input}.${createHmac('sha256', SECRET).update(input).digest('base64url')}`;
      },
    ],
  ];

  it.each(cases)('%s: IdentityError rejected, sem cause nem detalhes', async (_label, makeToken) => {
    const google = fakeGoogle();
    const p = provider(google);
    await p.init();
    const { checks } = await p.begin(REDIRECT_URI);
    google.state.idToken = makeToken(checks.nonce);
    const error = await rejection(p.complete(callback(checks), checks));
    expect(error.kind).toBe('rejected');
    expect(error.message).toBe('identity:rejected');
    expect(error.cause).toBeUndefined();
  });

  it('state da volta diferente do guardado: recusa antes de trocar o code', async () => {
    const google = fakeGoogle();
    const p = provider(google);
    await p.init();
    const { checks } = await p.begin(REDIRECT_URI);
    google.state.idToken = signJwt(idClaims(checks.nonce));
    expect((await rejection(p.complete(callback(checks, 'outro-state'), checks))).kind).toBe('rejected');
    expect(google.seen.some((r) => r.url === DISCOVERY.token_endpoint)).toBe(false);
  });

  it('o Google recusa o code (invalid_grant): rejected', async () => {
    const google = fakeGoogle();
    const p = provider(google);
    await p.init();
    const { checks } = await p.begin(REDIRECT_URI);
    google.state.tokenStatus = 400;
    expect((await rejection(p.complete(callback(checks), checks))).kind).toBe('rejected');
  });

  it('claims com tipo errado: invalid-claims', async () => {
    const google = fakeGoogle();
    const p = provider(google);
    await p.init();
    const { checks } = await p.begin(REDIRECT_URI);
    google.state.idToken = signJwt(idClaims(checks.nonce, { email_verified: 'true' }));
    expect((await rejection(p.complete(callback(checks), checks))).kind).toBe('invalid-claims');
  });
});

describe('createGoogleProvider: discovery', () => {
  it('antes do discovery, begin e complete dão unavailable', async () => {
    const p = provider();
    expect((await rejection(p.begin(REDIRECT_URI))).kind).toBe('unavailable');
    expect((await rejection(p.complete(new URL(REDIRECT_URI), { state: 'a', nonce: 'b', codeVerifier: 'c' }))).kind).toBe('unavailable');
  });

  it.each(['authorization_endpoint', 'token_endpoint', 'jwks_uri'])('%s fora dos hosts do Google: login indisponível', async (field) => {
    const kinds: DiscoveryErrorKind[] = [];
    const google = fakeGoogle({ ...DISCOVERY, [field]: 'https://evil.example.com/x' });
    const p = provider(google, clock(), (kind) => kinds.push(kind));
    expect(await p.init()).toBe(false);
    expect(p.available()).toBe(false);
    expect(kinds).toEqual(['invalid']);
    expect(google.seen.every((r) => !r.url.includes('evil.example.com'))).toBe(true);
  });

  it('documento com outro issuer: indisponível', async () => {
    const kinds: DiscoveryErrorKind[] = [];
    const p = provider(fakeGoogle({ ...DISCOVERY, issuer: 'https://evil.example.com' }), clock(), (kind) => kinds.push(kind));
    expect(await p.init()).toBe(false);
    expect(kinds).toEqual(['invalid']);
  });

  it('falha de rede: indisponível, com o tipo da falha; nova tentativa só depois de 1 minuto', async () => {
    const kinds: DiscoveryErrorKind[] = [];
    const google = fakeGoogle();
    const c = clock();
    const p = provider(google, c, (kind) => kinds.push(kind));
    google.state.down = true;
    expect(await p.init()).toBe(false);
    expect(kinds).toEqual(['network']);

    google.state.down = false;
    c.advance(DISCOVERY_RETRY_MS - 1);
    expect(p.available()).toBe(false);
    expect(google.seen).toHaveLength(1);

    c.advance(1);
    expect(p.available()).toBe(false);
    expect(await p.init()).toBe(true);
    expect(google.seen).toHaveLength(2);
    expect(p.available()).toBe(true);
  });

  it('chamadas simultâneas de init fazem um discovery só', async () => {
    const google = fakeGoogle();
    const p = provider(google);
    expect(await Promise.all([p.init(), p.init()])).toEqual([true, true]);
    expect(await p.init()).toBe(true);
    expect(google.seen).toHaveLength(1);
  });
});

describe('discoveryErrorKind', () => {
  it('acha o erro do fetch na cadeia de cause; o resto é invalid', () => {
    const wrapped = new Error('something went wrong', { cause: new CalendarFetchError('timeout') });
    expect(discoveryErrorKind(wrapped)).toBe('timeout');
    expect(discoveryErrorKind(new CalendarFetchError('redirect'))).toBe('redirect');
    expect(discoveryErrorKind(new Error('x'))).toBe('invalid');
    expect(discoveryErrorKind('x')).toBe('invalid');
  });
});
