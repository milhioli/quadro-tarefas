import type { MutableEnv } from '../calendar/config';

/** Hostnames de loopback aceitos no APP_ORIGIN local (dev e E2E). */
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
  /** Canal de privacidade e de incidente (rodapé e /privacidade). */
  readonly contactEmail: string | null;
  /** Quem responde pelo app (LGPD, art. 9º), mostrado na /privacidade. */
  readonly operatorName: string | null;
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
const OPERATOR_NAME_MAX_LENGTH = 120;
/** Controles e formatação invisível (inclusive os de direção): o nome é exibido na página. */
const HIDDEN_CHARACTERS = /[\p{Cc}\p{Cf}]/u;

export function isLoopbackOrigin(origin: URL): boolean {
  return origin.protocol === 'http:' && LOOPBACK_HOSTNAMES.has(origin.hostname);
}

/** Origem do deploy (atrás do Caddy, com TLS). Só vale junto com NODE_ENV=production (ver deployMode.ts). */
export function isPublicOrigin(origin: URL): boolean {
  return origin.protocol === 'https:';
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
  // https: o deploy (Caddy na frente). Qualquer outra coisa fora do loopback é recusada.
  if (isPublicOrigin(url)) return url;
  if (!isLoopbackOrigin(url)) {
    throw new AuthConfigError('APP_ORIGIN precisa ser http://127.0.0.1 (ou localhost) no local, ou https no deploy');
  }
  if (Number(url.port) !== webPort) {
    throw new AuthConfigError('APP_ORIGIN precisa usar a mesma porta do Vite (WEB_PORT)');
  }
  return url;
}

function optionalEmail(raw: string | undefined, name: string): string | null {
  const value = raw?.trim().toLowerCase() ?? '';
  if (value !== '' && !EMAIL_PATTERN.test(value)) throw new AuthConfigError(`${name} inválido`);
  return value === '' ? null : value;
}

function optionalOperatorName(raw: string | undefined): string | null {
  const value = raw?.trim() ?? '';
  if (value === '') return null;
  if (value.length > OPERATOR_NAME_MAX_LENGTH || HIDDEN_CHARACTERS.test(value)) {
    throw new AuthConfigError(`QUADRO_OPERATOR_NAME inválido: use até ${OPERATOR_NAME_MAX_LENGTH} caracteres visíveis`);
  }
  return value;
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
  const adminEmail = optionalEmail(env.QUADRO_ADMIN_EMAIL, 'QUADRO_ADMIN_EMAIL');
  const contactEmail = optionalEmail(env.QUADRO_CONTACT_EMAIL, 'QUADRO_CONTACT_EMAIL');
  const operatorName = optionalOperatorName(env.QUADRO_OPERATOR_NAME);
  const base = { appOrigin, adminEmail, contactEmail, operatorName };

  if ((clientId === '') !== (secret === '')) {
    throw new AuthConfigError('Informe GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET juntos (ou nenhum dos dois)');
  }
  if (clientId === '') return { ...base, google: null, googleOffReason: 'not-configured' };
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    return { ...base, google: null, googleOffReason: 'tls-disabled' };
  }
  return { ...base, google: { clientId, clientSecret: () => secret }, googleOffReason: null };
}
