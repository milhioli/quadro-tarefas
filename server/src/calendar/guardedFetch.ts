/**
 * Única saída de rede do servidor. Regras comuns:
 * - só https, sem porta nem userinfo, e só os hosts exatos de cada provedor
 *   (allowlist POR PROVEDOR: credencial da Apple nunca vai a host do Google e
 *   vice-versa);
 * - a URL é validada antes de qualquer header sair;
 * - timeout por requisição e limite de bytes, contados sobre o corpo já
 *   descomprimido (lido pelo stream, sem confiar em Content-Length).
 *
 * Apple (CalDAV, `createGuardedFetch`): quem chama não passa headers; o
 * Authorization vem só daqui, montado depois de validar a URL de cada salto
 * (até 3 redirecionamentos).
 *
 * Google (OIDC, `createOidcFetch`): é o `customFetch` do openid-client, que
 * monta os próprios headers e corpo. Aqui só passam GET e POST, nenhum
 * redirecionamento é seguido e a resposta volta só com os headers que a
 * biblioteca usa.
 */

export const CALDAV_ROOT_HOST = 'caldav.icloud.com';
const PARTITION_HOST = /^p\d{1,4}-caldav\.icloud\.com$/;
export const GOOGLE_HOSTS: ReadonlySet<string> = new Set([
  'accounts.google.com',
  'oauth2.googleapis.com',
  'www.googleapis.com',
]);

export type OutboundProvider = 'apple' | 'google';

const PROVIDER_HOSTS: Readonly<Record<OutboundProvider, (host: string) => boolean>> = Object.freeze({
  apple: (host: string) => host === CALDAV_ROOT_HOST || PARTITION_HOST.test(host),
  google: (host: string) => GOOGLE_HOSTS.has(host),
});

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const DEFAULT_MAX_WEEK_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_REDIRECTS = 3;
export const DEFAULT_OIDC_MAX_RESPONSE_BYTES = 256 * 1024;

export type CalendarFetchErrorKind = 'blocked-url' | 'redirect' | 'too-large' | 'timeout' | 'network' | 'http';

export class CalendarFetchError extends Error {
  readonly kind: CalendarFetchErrorKind;
  readonly status: number | undefined;

  constructor(kind: CalendarFetchErrorKind, status?: number) {
    // Mensagem sem URL, header nem corpo: pode acabar num log.
    super(status === undefined ? `calendar-fetch:${kind}` : `calendar-fetch:${kind}:${status}`);
    this.name = 'CalendarFetchError';
    this.kind = kind;
    this.status = status;
  }
}

/** URL permitida para o provedor, ou null. */
export function allowedUrl(provider: OutboundProvider, raw: string | URL, base?: string | URL): URL | null {
  let url: URL;
  try {
    url = base === undefined ? new URL(raw) : new URL(raw, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') return null;
  return PROVIDER_HOSTS[provider](url.hostname.toLowerCase()) ? url : null;
}

/** URL permitida para o CalDAV do iCloud, ou null. */
export function allowedCaldavUrl(raw: string | URL, base?: string | URL): URL | null {
  return allowedUrl('apple', raw, base);
}

export interface ByteBudget {
  used: number;
  readonly max: number;
}

export function createByteBudget(max: number = DEFAULT_MAX_WEEK_BYTES): ByteBudget {
  return { used: 0, max };
}

export interface DavRequest {
  method: 'PROPFIND' | 'REPORT';
  depth: '0' | '1';
  body: string;
}

export interface DavResponse {
  status: number;
  /** URL final (depois dos redirecionamentos), para resolver hrefs relativos. */
  url: URL;
  text: string;
}

export type DavFetch = (url: string | URL, request: DavRequest, budget: ByteBudget) => Promise<DavResponse>;

export type FetchImpl = (input: string, init: RequestInit) => Promise<Response>;

/** A única chamada a `fetch(` de server/src. */
const networkFetch: FetchImpl = (input, init) => fetch(input, init);

export interface GuardedFetchOptions {
  authorization: () => string;
  fetch?: FetchImpl;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

async function readLimitedBytes(
  response: Response,
  maxBytes: number,
  budget: ByteBudget,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      budget.used += value.byteLength;
      if (total > maxBytes || budget.used > budget.max) {
        await reader.cancel().catch(() => undefined);
        throw new CalendarFetchError('too-large');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof CalendarFetchError) throw error;
    throw new CalendarFetchError(isTimeout(error) ? 'timeout' : 'network');
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readLimited(response: Response, maxBytes: number, budget: ByteBudget): Promise<string> {
  return new TextDecoder('utf-8').decode(await readLimitedBytes(response, maxBytes, budget));
}

export function createGuardedFetch(options: GuardedFetchOptions): DavFetch {
  const doFetch: FetchImpl = options.fetch ?? networkFetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  return async (rawUrl, request, budget) => {
    const initial = allowedCaldavUrl(rawUrl);
    if (!initial) throw new CalendarFetchError('blocked-url');
    let url: URL = initial;

    for (let hop = 0; ; hop++) {
      // O Authorization só é montado depois de a URL deste salto ser validada.
      const headers: Record<string, string> = {
        Authorization: options.authorization(),
        Depth: request.depth,
        'Content-Type': 'application/xml; charset=utf-8',
        Accept: 'application/xml, text/xml',
      };
      let response: Response;
      try {
        response = await doFetch(url.href, {
          method: request.method,
          headers,
          body: request.body,
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new CalendarFetchError(isTimeout(error) ? 'timeout' : 'network');
      }

      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => undefined);
        if (hop >= maxRedirects) throw new CalendarFetchError('redirect');
        const location = response.headers.get('location');
        const next: URL | null = location ? allowedCaldavUrl(location, url) : null;
        if (!next) throw new CalendarFetchError('redirect');
        url = next;
        continue;
      }

      const text = await readLimited(response, maxBytes, budget);
      return { status: response.status, url, text };
    }
  };
}

/** O que o openid-client passa para o `customFetch`. */
export interface OidcFetchInit {
  method: string;
  headers: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
  redirect?: string;
}

export type OidcFetch = (url: string, init: OidcFetchInit) => Promise<Response>;

export interface OidcFetchOptions {
  fetch?: FetchImpl;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

/** Headers da resposta que o openid-client usa; o resto não volta. */
const OIDC_RESPONSE_HEADERS = ['content-type', 'cache-control', 'www-authenticate', 'retry-after'] as const;
const NO_BODY_STATUS: ReadonlySet<number> = new Set([204, 205, 304]);

/**
 * `customFetch` do openid-client, preso aos hosts do Google: discovery, JWKS
 * (GET) e troca do code (POST). Redirecionamento vira erro; o corpo é lido com
 * teto; a resposta é um `Response` novo, só com os headers necessários.
 */
export function createOidcFetch(options: OidcFetchOptions = {}): OidcFetch {
  const doFetch: FetchImpl = options.fetch ?? networkFetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxResponseBytes ?? DEFAULT_OIDC_MAX_RESPONSE_BYTES;

  return async (rawUrl, init) => {
    const url = allowedUrl('google', rawUrl);
    if (!url || (init.method !== 'GET' && init.method !== 'POST')) throw new CalendarFetchError('blocked-url');
    const timeout = AbortSignal.timeout(timeoutMs);

    let response: Response;
    try {
      response = await doFetch(url.href, {
        method: init.method,
        headers: init.headers,
        body: init.body as RequestInit['body'],
        redirect: 'manual',
        signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
      });
    } catch (error) {
      throw new CalendarFetchError(isTimeout(error) ? 'timeout' : 'network');
    }

    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      throw new CalendarFetchError('redirect');
    }

    const bytes = await readLimitedBytes(response, maxBytes, createByteBudget(maxBytes));
    const headers = new Headers();
    for (const name of OIDC_RESPONSE_HEADERS) {
      const value = response.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    return new Response(NO_BODY_STATUS.has(response.status) ? null : bytes, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
