import { describe, expect, it, vi } from 'vitest';
import {
  CalendarFetchError,
  allowedCaldavUrl,
  allowedUrl,
  createByteBudget,
  createGuardedFetch,
  createOidcFetch,
  type DavRequest,
  type FetchImpl,
} from './guardedFetch';

const AUTH = 'Basic dGVzdGU6dGVzdGU=';
const REQUEST: DavRequest = { method: 'PROPFIND', depth: '0', body: '<x/>' };

function kindOf(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => 'ok',
    (error: unknown) => (error instanceof CalendarFetchError ? error.kind : `outro: ${String(error)}`),
  );
}

function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl: FetchImpl = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { calls, impl };
}

const headerOf = (init: RequestInit | undefined, name: string) => (init?.headers as Record<string, string>)[name];

describe('allowedCaldavUrl', () => {
  it.each(['https://caldav.icloud.com/', 'https://p00-caldav.icloud.com/000000000/calendars/', 'https://P67-CALDAV.icloud.com/x'])(
    'aceita %s',
    (url) => {
      expect(allowedCaldavUrl(url)).not.toBeNull();
    },
  );

  it.each([
    'http://caldav.icloud.com/',
    'https://caldav.icloud.com:8443/',
    'https://user:pass@caldav.icloud.com/',
    'https://icloud.com.evil.com/',
    'https://caldav.icloud.com.evil.com/',
    'https://evilicloud.com/',
    'https://www.icloud.com/',
    'https://p1-caldav.icloud.com.evil.com/',
    'https://px-caldav.icloud.com/',
    'https://17.0.0.1/',
    'https://[::1]/',
    'file:///etc/passwd',
    'não é url',
  ])('recusa %s', (url) => {
    expect(allowedCaldavUrl(url)).toBeNull();
  });

  it('resolve relativo contra a base e revalida', () => {
    expect(allowedCaldavUrl('/000000000/principal/', 'https://caldav.icloud.com/')?.href).toBe(
      'https://caldav.icloud.com/000000000/principal/',
    );
    expect(allowedCaldavUrl('https://evil.com/x', 'https://caldav.icloud.com/')).toBeNull();
  });
});

describe('createGuardedFetch', () => {
  it('manda o Authorization e os headers do CalDAV só para host permitido', async () => {
    const { calls, impl } = fakeFetch(() => new Response('<ok/>', { status: 207 }));
    const davFetch = createGuardedFetch({ authorization: () => AUTH, fetch: impl });
    const res = await davFetch('https://caldav.icloud.com/', REQUEST, createByteBudget());
    expect(res).toMatchObject({ status: 207, text: '<ok/>' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init).toMatchObject({ method: 'PROPFIND', redirect: 'manual', body: '<x/>' });
    expect(calls[0]?.init.headers).toEqual({
      Authorization: AUTH,
      Depth: '0',
      'Content-Type': 'application/xml; charset=utf-8',
      Accept: 'application/xml, text/xml',
    });
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('recusa URL fora do allowlist sem nem chamar a rede', async () => {
    const authorization = vi.fn(() => AUTH);
    const { calls, impl } = fakeFetch(() => new Response(''));
    const davFetch = createGuardedFetch({ authorization, fetch: impl });
    expect(await kindOf(davFetch('https://evil.com/', REQUEST, createByteBudget()))).toBe('blocked-url');
    expect(calls).toHaveLength(0);
    expect(authorization).not.toHaveBeenCalled();
  });

  it('segue redirecionamento para host permitido, revalidando', async () => {
    const { calls, impl } = fakeFetch((url) =>
      url === 'https://caldav.icloud.com/'
        ? new Response(null, { status: 301, headers: { location: 'https://p00-caldav.icloud.com/000000000/' } })
        : new Response('<ok/>', { status: 207 }),
    );
    const res = await createGuardedFetch({ authorization: () => AUTH, fetch: impl })(
      'https://caldav.icloud.com/',
      REQUEST,
      createByteBudget(),
    );
    expect(res.url.href).toBe('https://p00-caldav.icloud.com/000000000/');
    expect(calls.map((c) => c.url)).toEqual(['https://caldav.icloud.com/', 'https://p00-caldav.icloud.com/000000000/']);
    expect(headerOf(calls[1]?.init, 'Authorization')).toBe(AUTH);
  });

  it.each(['https://evil.com/', 'http://p00-caldav.icloud.com/', 'https://caldav.icloud.com.evil.com/', '//evil.com/x'])(
    'redirecionamento para %s é recusado sem reenviar o Authorization',
    async (location) => {
      const { calls, impl } = fakeFetch(() => new Response(null, { status: 302, headers: { location } }));
      const davFetch = createGuardedFetch({ authorization: () => AUTH, fetch: impl });
      expect(await kindOf(davFetch('https://caldav.icloud.com/', REQUEST, createByteBudget()))).toBe('redirect');
      expect(calls).toHaveLength(1);
    },
  );

  it('redirecionamento sem Location é recusado', async () => {
    const { impl } = fakeFetch(() => new Response(null, { status: 307 }));
    const davFetch = createGuardedFetch({ authorization: () => AUTH, fetch: impl });
    expect(await kindOf(davFetch('https://caldav.icloud.com/', REQUEST, createByteBudget()))).toBe('redirect');
  });

  it('no máximo 3 saltos', async () => {
    const { calls, impl } = fakeFetch(
      () => new Response(null, { status: 301, headers: { location: 'https://caldav.icloud.com/loop' } }),
    );
    const davFetch = createGuardedFetch({ authorization: () => AUTH, fetch: impl });
    expect(await kindOf(davFetch('https://caldav.icloud.com/', REQUEST, createByteBudget()))).toBe('redirect');
    expect(calls).toHaveLength(4);
  });

  it('corta a resposta acima do limite, sem confiar em Content-Length', async () => {
    const { impl } = fakeFetch(
      () => new Response('x'.repeat(1025), { status: 207, headers: { 'content-length': '10' } }),
    );
    const davFetch = createGuardedFetch({ authorization: () => AUTH, fetch: impl, maxResponseBytes: 1024 });
    expect(await kindOf(davFetch('https://caldav.icloud.com/', REQUEST, createByteBudget()))).toBe('too-large');
  });

  it('respeita o teto agregado da semana', async () => {
    const { impl } = fakeFetch(() => new Response('y'.repeat(600), { status: 207 }));
    const davFetch = createGuardedFetch({ authorization: () => AUTH, fetch: impl });
    const budget = createByteBudget(1000);
    await expect(davFetch('https://caldav.icloud.com/', REQUEST, budget)).resolves.toMatchObject({ status: 207 });
    expect(await kindOf(davFetch('https://caldav.icloud.com/', REQUEST, budget))).toBe('too-large');
  });

  it('aborta por timeout', async () => {
    const impl: FetchImpl = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    const davFetch = createGuardedFetch({ authorization: () => AUTH, fetch: impl, timeoutMs: 20 });
    expect(await kindOf(davFetch('https://caldav.icloud.com/', REQUEST, createByteBudget()))).toBe('timeout');
  });

  it('falha de rede vira erro sem detalhes', async () => {
    const impl: FetchImpl = async () => {
      throw new TypeError('getaddrinfo ENOTFOUND caldav.icloud.com segredo');
    };
    const davFetch = createGuardedFetch({ authorization: () => AUTH, fetch: impl });
    const error = await davFetch('https://caldav.icloud.com/', REQUEST, createByteBudget()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CalendarFetchError);
    expect((error as Error).message).toBe('calendar-fetch:network');
  });

  it('devolve status de erro para quem chama decidir (ex.: 401)', async () => {
    const { impl } = fakeFetch(() => new Response('negado', { status: 401 }));
    const res = await createGuardedFetch({ authorization: () => AUTH, fetch: impl })(
      'https://caldav.icloud.com/',
      REQUEST,
      createByteBudget(),
    );
    expect(res.status).toBe(401);
  });

  it('a mensagem do erro não leva URL nem credencial', () => {
    expect(new CalendarFetchError('http', 401).message).toBe('calendar-fetch:http:401');
  });

  it('host do Google é recusado no fetch da Apple (a credencial da Apple não sai para lá)', async () => {
    const { calls, impl } = fakeFetch(() => new Response('ok'));
    const davFetch = createGuardedFetch({ authorization: () => AUTH, fetch: impl });
    expect(await kindOf(davFetch('https://oauth2.googleapis.com/token', REQUEST, createByteBudget()))).toBe('blocked-url');
    expect(calls).toHaveLength(0);
  });
});

describe('allowedUrl por provedor', () => {
  it('cada provedor só aceita os próprios hosts', () => {
    for (const host of ['accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com']) {
      expect(allowedUrl('google', `https://${host}/x`)).not.toBeNull();
      expect(allowedUrl('apple', `https://${host}/x`)).toBeNull();
    }
    expect(allowedUrl('google', 'https://caldav.icloud.com/')).toBeNull();
    expect(allowedUrl('google', 'https://p01-caldav.icloud.com/')).toBeNull();
  });

  it.each([
    'http://accounts.google.com/',
    'https://accounts.google.com:8443/',
    'https://user:pass@accounts.google.com/',
    'https://accounts.google.com.evil.com/',
    'https://evilaccounts.google.com/',
    'https://googleapis.com/',
    'https://openidconnect.googleapis.com/',
    'não é url',
  ])('Google recusa %s', (url) => {
    expect(allowedUrl('google', url)).toBeNull();
  });
});

describe('createOidcFetch (Google)', () => {
  const jsonResponse = (status = 200) =>
    new Response('{"ok":true}', {
      status,
      headers: { 'content-type': 'application/json', 'set-cookie': 'x=1', 'x-outro': 'y', 'cache-control': 'no-store' },
    });

  it('passa GET e POST para host do Google e devolve um Response só com os headers necessários', async () => {
    const { calls, impl } = fakeFetch(() => jsonResponse());
    const oidcFetch = createOidcFetch({ fetch: impl });
    const response = await oidcFetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code' }),
    });
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('x-outro')).toBeNull();
    expect(await response.json()).toEqual({ ok: true });
    expect(calls[0]?.init.redirect).toBe('manual');
    expect(calls[0]?.init.method).toBe('POST');
  });

  it('recusa host da Apple ou desconhecido sem chamar a rede', async () => {
    const { calls, impl } = fakeFetch(() => jsonResponse());
    const oidcFetch = createOidcFetch({ fetch: impl });
    for (const url of ['https://caldav.icloud.com/', 'https://evil.com/token', 'http://oauth2.googleapis.com/token']) {
      expect(await kindOf(oidcFetch(url, { method: 'GET', headers: {} }))).toBe('blocked-url');
    }
    expect(calls).toHaveLength(0);
  });

  it('só GET e POST', async () => {
    const { calls, impl } = fakeFetch(() => jsonResponse());
    const oidcFetch = createOidcFetch({ fetch: impl });
    expect(await kindOf(oidcFetch('https://oauth2.googleapis.com/token', { method: 'PUT', headers: {} }))).toBe('blocked-url');
    expect(calls).toHaveLength(0);
  });

  it('qualquer redirecionamento vira erro', async () => {
    const { impl } = fakeFetch(() => new Response(null, { status: 302, headers: { location: 'https://accounts.google.com/x' } }));
    const oidcFetch = createOidcFetch({ fetch: impl });
    expect(await kindOf(oidcFetch('https://accounts.google.com/.well-known/openid-configuration', { method: 'GET', headers: {} }))).toBe(
      'redirect',
    );
  });

  it('corta a resposta acima do limite', async () => {
    const { impl } = fakeFetch(() => new Response('x'.repeat(2048)));
    const oidcFetch = createOidcFetch({ fetch: impl, maxResponseBytes: 1024 });
    expect(await kindOf(oidcFetch('https://www.googleapis.com/oauth2/v3/certs', { method: 'GET', headers: {} }))).toBe('too-large');
  });

  it('falha de rede e timeout viram erro sem detalhes', async () => {
    const failing = createOidcFetch({
      fetch: async () => {
        throw new Error('getaddrinfo ENOTFOUND accounts.google.com segredo');
      },
    });
    const error = await failing('https://accounts.google.com/x', { method: 'GET', headers: {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CalendarFetchError);
    expect((error as Error).message).toBe('calendar-fetch:network');

    const slow = createOidcFetch({
      timeoutMs: 20,
      fetch: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    });
    expect(await kindOf(slow('https://accounts.google.com/x', { method: 'GET', headers: {} }))).toBe('timeout');
  });

  it('nunca usa o fetch global quando recebe um fetch próprio', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch global chamado');
    });
    try {
      const { impl } = fakeFetch(() => jsonResponse());
      await createOidcFetch({ fetch: impl })('https://accounts.google.com/x', { method: 'GET', headers: {} });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
