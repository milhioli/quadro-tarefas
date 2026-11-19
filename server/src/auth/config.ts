import type { MutableEnv } from '../calendar/config';

/** Hostnames de loopback aceitos no APP_ORIGIN da Fase 2a (sem deploy, sem rede). */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost']);

export type GoogleOffReason = 'not-configured' | 'tls-disabled';

export interface GoogleConfig {
  readonly clientId: string;
  /** O segredo só existe nesta closure; nunca em objeto, log ou erro. */
  readonly clientSecret: () => string;
}

export interface AuthConfig {
  /** Origem pública do app (ex.: http://127.0.0.1:5173). O redirect do Google sai daqui, nunca do Host. */
  readonly appOrigin: URL;
  /** E-mail (verificado) que recebe o seq 0 e o papel de admin, uma vez só. */
  readonly adminEmail: string | null;
  readonly google: GoogleConfig | null;
  readonly googleOffReason: GoogleOffReason | null;
}

export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthConfigError';
  }
}

const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;

export function isLoopbackOrigin(origin: URL): boolean {
  return origin.protocol === 'http:' && LOOPBACK_HOSTNAMES.has(origin.hostname);
}

function parseAppOrigin(raw: string | undefined, webPort: number): URL {
  const value = raw?.trim() ? raw.trim() : `http://127.0.0.1:${webPort}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AuthConfigError('APP_ORIGIN inválida: use uma origem como http://127.0.0.1:5173');
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '') {
    throw new AuthConfigError('APP_ORIGIN inválida: use só esquema, host e porta, sem caminho');
  }
  // Fase 2a: só loopback. Abrir para a rede exige o deploy da 2b (HTTPS, __Host-, CSP do HTML).
  if (!isLoopbackOrigin(url)) {
    throw new AuthConfigError('APP_ORIGIN precisa ser http://127.0.0.1 (ou localhost) nesta fase');
  }
  if (Number(url.port) !== webPort) {
    throw new AuthConfigError('APP_ORIGIN precisa usar a mesma porta do Vite (WEB_PORT)');
  }
  return url;
}

/**
 * Lê a configuração do login.
 * - GOOGLE_CLIENT_SECRET sai do ambiente sempre, mesmo sem o client id.
 * - Client id e secret vêm juntos ou nenhum dos dois.
 * - Mensagens de erro nunca ecoam valores.
 */
export function loadAuthConfig(env: MutableEnv, options: { webPort: number }): AuthConfig {
  const clientId = env.GOOGLE_CLIENT_ID?.trim() ?? '';
  const secret = env.GOOGLE_CLIENT_SECRET?.trim() ?? '';
  delete env.GOOGLE_CLIENT_SECRET;

  const appOrigin = parseAppOrigin(env.APP_ORIGIN, options.webPort);

  const adminRaw = env.QUADRO_ADMIN_EMAIL?.trim().toLowerCase() ?? '';
  if (adminRaw !== '' && !EMAIL_PATTERN.test(adminRaw)) {
    throw new AuthConfigError('QUADRO_ADMIN_EMAIL inválido');
  }
  const adminEmail = adminRaw === '' ? null : adminRaw;

  if ((clientId === '') !== (secret === '')) {
    throw new AuthConfigError('Informe GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET juntos (ou nenhum dos dois)');
  }
  if (clientId === '') return { appOrigin, adminEmail, google: null, googleOffReason: 'not-configured' };
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    return { appOrigin, adminEmail, google: null, googleOffReason: 'tls-disabled' };
  }
  return {
    appOrigin,
    adminEmail,
    google: { clientId, clientSecret: () => secret },
    googleOffReason: null,
  };
}
