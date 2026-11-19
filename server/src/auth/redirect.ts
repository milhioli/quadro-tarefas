/** Tamanho máximo do `next` aceito no início do login. */
export const NEXT_MAX_LENGTH = 512;

/**
 * Caracteres aceitos no `next`: os de um caminho do app (`/`, `/?board=3`).
 * Fora ficam espaço, tab e quebra de linha (o parser de URL os remove, e
 * `/<tab>/evil.com` viraria `//evil.com`), controles, barra invertida e aspas.
 */
const NEXT_CHARACTERS = /^[A-Za-z0-9\-._~/?#&=%+,;:]*$/;

/** Começa com uma barra só: nem `//host` nem `/\host` (que os navegadores leem como `//host`). */
const SINGLE_SLASH_PATH = /^\/(?![/\\])/;

/**
 * Destino depois do login: só um caminho relativo da mesma origem do
 * APP_ORIGIN. Qualquer outra coisa (`//evil.com`, `/\evil.com`,
 * `/%2F%2Fevil.com`, `https://evil.com`, `javascript:`) vira `/`. Rotas da API
 * também viram `/`, para não cair num laço de login.
 */
export function sanitizeNext(raw: unknown, appOrigin: URL): string {
  if (typeof raw !== 'string' || raw.length > NEXT_MAX_LENGTH) return '/';
  if (!NEXT_CHARACTERS.test(raw) || !SINGLE_SLASH_PATH.test(raw)) return '/';

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return '/';
  }
  if (!SINGLE_SLASH_PATH.test(decoded)) return '/';

  let url: URL;
  try {
    url = new URL(raw, appOrigin);
  } catch {
    return '/';
  }
  if (url.origin !== appOrigin.origin) return '/';
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return '/';
  return `${url.pathname}${url.search}${url.hash}`;
}
