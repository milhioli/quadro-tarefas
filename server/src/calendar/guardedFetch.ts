/**
 * Única saída de rede do servidor (agenda da Apple). Regras:
 * - só https, sem porta nem userinfo, e só os hosts CalDAV do iCloud;
 * - a URL é validada em toda requisição e em cada salto de redirecionamento,
 *   antes de o Authorization ser montado;
 * - quem chama não passa headers: o Authorization vem só daqui;
 * - timeout por requisição e limite de bytes (por resposta e por semana),
 *   contados sobre o corpo já descomprimido.
 */

export const CALDAV_ROOT_HOST = 'caldav.icloud.com';
const PARTITION_HOST = /^p\d{1,4}-caldav\.icloud\.com$/;

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const DEFAULT_MAX_WEEK_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_REDIRECTS = 3;

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

/** URL permitida para o CalDAV do iCloud, ou null. */
export function allowedCaldavUrl(raw: string | URL, base?: string | URL): URL | null {
  let url: URL;
  try {
    url = base === undefined ? new URL(raw) : new URL(raw, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') return null;
  const host = url.hostname.toLowerCase();
  return host === CALDAV_ROOT_HOST || PARTITION_HOST.test(host) ? url : null;
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

async function readLimited(response: Response, maxBytes: number, budget: ByteBudget): Promise<string> {
  if (!response.body) return '';
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
  return new TextDecoder('utf-8').decode(bytes);
}

export function createGuardedFetch(options: GuardedFetchOptions): DavFetch {
  const doFetch: FetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
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
