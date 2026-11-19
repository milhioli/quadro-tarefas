import type { FastifyInstance } from 'fastify';
import type { Now } from '../clock';
import { tooManyRequests } from './errors';
import { isSafeMethod } from './guard';

/**
 * Limites de taxa em memória (Fase 2b, docs/fase-2b.md). Janela fixa por chave,
 * com o relógio injetado: os testes avançam o tempo sem timers falsos.
 *
 * Os contadores somem quando o processo reinicia. Tetos que precisam durar
 * (grupos por dono, bloqueio de reconvite) ficam no banco.
 */
export interface RateRule {
  limit: number;
  windowMs: number;
}

export interface RateLimiter {
  /** Conta uma tentativa. false = passou do limite (a tentativa não é contada). */
  hit(key: string): boolean;
  size(): number;
}

export const RATE_LIMITER_MAX_KEYS = 10_000;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Os limites da tabela do plano. Os testes trocam qualquer um por `overrides`. */
export const RATE_LIMITS = Object.freeze({
  /** Início do login Google, por IP. */
  loginStart: { limit: 20, windowMs: 10 * MINUTE },
  /** Contas novas no total, por hora. */
  signupGlobal: { limit: 30, windowMs: HOUR },
  /** Contas novas por IP, por dia. */
  signupPerIp: { limit: 5, windowMs: DAY },
  /** A mesma conta Google criando conta de novo (ciclo cadastrar → apagar). */
  signupPerSub: { limit: 2, windowMs: DAY },
  /** Mutações por pessoa. */
  mutation: { limit: 300, windowMs: 5 * MINUTE },
  /** Grupos criados por pessoa. */
  groupCreate: { limit: 10, windowMs: HOUR },
  /** Convites enviados por pessoa (inclusive para handle que não existe). */
  invite: { limit: 30, windowMs: DAY },
} satisfies Record<string, RateRule>);

export type LimitName = keyof typeof RATE_LIMITS;
export type Limiters = Readonly<Record<LimitName, RateLimiter>>;

export function createRateLimiter(now: Now, rule: RateRule, maxKeys = RATE_LIMITER_MAX_KEYS): RateLimiter {
  // Todas as janelas têm o mesmo tamanho: a ordem de inserção do Map é a ordem
  // de vencimento, então a poda para na primeira janela ainda aberta.
  const windows = new Map<string, { resetAt: number; count: number }>();

  function prune(at: number): void {
    for (const [key, window] of windows) {
      if (window.resetAt > at) break;
      windows.delete(key);
    }
  }

  return {
    hit(key) {
      const at = now().getTime();
      prune(at);
      let window = windows.get(key);
      if (window === undefined) {
        // Cheio mesmo depois da poda: descarta a chave mais antiga. A memória
        // fica limitada, e o pior caso é uma chave recomeçar a contagem.
        if (windows.size >= maxKeys) {
          const oldest = windows.keys().next();
          if (!oldest.done) windows.delete(oldest.value);
        }
        window = { resetAt: at + rule.windowMs, count: 0 };
        windows.set(key, window);
      }
      if (window.count >= rule.limit) return false;
      window.count += 1;
      return true;
    },
    size: () => windows.size,
  };
}

export function createLimiters(now: Now, overrides: Partial<Record<LimitName, RateRule>> = {}): Limiters {
  const names = Object.keys(RATE_LIMITS) as LimitName[];
  return Object.freeze(
    Object.fromEntries(names.map((name) => [name, createRateLimiter(now, overrides[name] ?? RATE_LIMITS[name])])) as Record<
      LimitName,
      RateLimiter
    >,
  );
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV4_MAPPED = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;
const DOUBLE_COLON = /::/;

/**
 * A chave de um IP nos limites: o IPv4 inteiro, ou o prefixo /64 do IPv6
 * (uma pessoa com IPv6 costuma ter um /64 inteiro para trocar de endereço).
 * O IP nunca vai para log nem banco.
 */
export function ipRateKey(ip: string): string {
  const address = ip.trim().toLowerCase().replace(/%.*$/, '');
  if (IPV4.test(address)) return address;
  const mapped = IPV4_MAPPED.exec(address);
  if (mapped) return mapped[1] as string;
  const groups = expandIpv6(address);
  return groups === null ? `raw:${address.slice(0, 64)}` : `${groups.slice(0, 4).join(':')}/64`;
}

function expandIpv6(address: string): string[] | null {
  const halves = address.split(DOUBLE_COLON);
  if (halves.length > 2) return null;
  const split = (part: string | undefined): string[] => (part ? part.split(':') : []);
  const head = split(halves[0]);
  const tail = split(halves[1]);
  // Um IPv4 no fim (ex.: 64:ff9b::1.2.3.4) ocupa dois grupos.
  const tailGroups = tail.length > 0 && (tail[tail.length - 1] as string).includes('.') ? tail.length + 1 : tail.length;
  const missing = 8 - head.length - tailGroups;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const all = [...head, ...Array<string>(halves.length === 1 ? 0 : missing).fill('0'), ...tail];
  const normalized: string[] = [];
  for (const group of all.slice(0, 4)) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    normalized.push(Number.parseInt(group, 16).toString(16));
  }
  return normalized;
}

/**
 * Limite de mutações por pessoa: hook na raiz, depois da sessão (precisa saber
 * quem é). GET/HEAD e quem não tem sessão não contam.
 */
export function registerMutationLimit(app: FastifyInstance, limiter: RateLimiter): void {
  app.addHook('onRequest', async (request) => {
    const user = (request as { user?: { id: number } | null }).user;
    if (!user || isSafeMethod(request.method)) return;
    if (!limiter.hit(`u:${user.id}`)) throw tooManyRequests();
  });
}
