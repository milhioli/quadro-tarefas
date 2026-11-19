/** A API só escuta na interface de loopback. Não é configurável de propósito. */
export const API_HOST = '127.0.0.1';
export const ALLOWED_HOSTNAMES: readonly string[] = Object.freeze(['127.0.0.1', 'localhost']);

export const DEFAULT_API_PORT = 3001;
export const DEFAULT_WEB_PORT = 5173;
/** Disjuntor de disco: acima disso o banco não aceita criar nem editar tarefas. */
export const DEFAULT_DB_MAX_MB = 1024;

export interface AppConfig {
  host: typeof API_HOST;
  port: number;
  webPort: number;
  dbPath: string;
  /** QUADRO_DB_MAX_MB: tamanho máximo do banco, em MiB. */
  dbMaxMb: number;
}

export interface GuardOptions {
  allowedHostnames: readonly string[];
  allowedPorts: readonly number[];
  allowedOrigins: readonly string[];
  /**
   * Deploy (atrás do Caddy): o único Host aceito, sem porta (o host do
   * APP_ORIGIN). null no local, onde valem hostname + porta de loopback.
   */
  publicHost: string | null;
}

export type Env = Readonly<Record<string, string | undefined>>;

function parsePort(raw: string | undefined, fallback: number, name: string, allowEphemeral: boolean): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = raw.trim();
  if (!/^\d{1,5}$/.test(value)) throw new Error(`${name} inválida: use um número de porta`);
  const port = Number(value);
  if (allowEphemeral && port === 0) return 0;
  if (port < 1024 || port > 65535) throw new Error(`${name} inválida: use uma porta entre 1024 e 65535`);
  return port;
}

function parseDbMaxMb(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_DB_MAX_MB;
  const value = raw.trim();
  if (!/^\d{1,7}$/.test(value) || Number(value) < 16) {
    throw new Error('QUADRO_DB_MAX_MB inválido: use um número de MiB a partir de 16');
  }
  return Number(value);
}

export function loadConfig(env: Env, defaults: { dbPath: string }): AppConfig {
  const port = parsePort(env.API_PORT, DEFAULT_API_PORT, 'API_PORT', true);
  const webPort = parsePort(env.WEB_PORT, DEFAULT_WEB_PORT, 'WEB_PORT', false);
  const dbPath = env.DB_PATH?.trim() ? env.DB_PATH.trim() : defaults.dbPath;
  return { host: API_HOST, port, webPort, dbPath, dbMaxMb: parseDbMaxMb(env.QUADRO_DB_MAX_MB) };
}

/** Hosts, portas e origens aceitos pelo guard, derivados da configuração. */
export function guardOptionsFor(config: Pick<AppConfig, 'port' | 'webPort'>): GuardOptions {
  const ports = [config.port, config.webPort].filter((p) => p !== 0);
  return {
    allowedHostnames: ALLOWED_HOSTNAMES,
    allowedPorts: Object.freeze([...new Set(ports)]),
    allowedOrigins: Object.freeze(ALLOWED_HOSTNAMES.map((host) => `http://${host}:${config.webPort}`)),
    publicHost: null,
  };
}

/**
 * Guard do deploy: Host igual ao host do APP_ORIGIN e Origin igual ao
 * APP_ORIGIN, e nada mais (nem loopback: o health check do contêiner manda o
 * Host público).
 */
export function publicGuardOptions(appOrigin: URL): GuardOptions {
  return {
    allowedHostnames: Object.freeze([]),
    allowedPorts: Object.freeze([]),
    allowedOrigins: Object.freeze([appOrigin.origin]),
    publicHost: appOrigin.host,
  };
}

export const DEFAULT_GUARD_OPTIONS: GuardOptions = guardOptionsFor({
  port: DEFAULT_API_PORT,
  webPort: DEFAULT_WEB_PORT,
});
