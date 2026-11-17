import type { CalendarEvent } from '@quadro/shared';
import { HttpError } from '../http/errors';
import type { CalendarSource, WeekRange } from './caldavClient';
import { CalendarFetchError } from './guardedFetch';
import { defaultParseBudget, parseWeek, type ParseBudget } from './parseEvents';

export const CACHE_TTL_MS = 5 * 60_000;
export const AUTH_COOLDOWN_MS = 15 * 60_000;
export const MAX_CACHED_WEEKS = 8;

export const UPSTREAM_MESSAGE = 'Não foi possível ler a agenda da Apple';
export const UPSTREAM_AUTH_MESSAGE = 'A Apple recusou a senha de app. Gere outra em account.apple.com.';

export const upstreamError = (): HttpError => new HttpError(502, 'UPSTREAM', UPSTREAM_MESSAGE);
export const upstreamAuthError = (): HttpError => new HttpError(502, 'UPSTREAM_AUTH', UPSTREAM_AUTH_MESSAGE);

/** Só o tipo do problema e o status HTTP. Nunca erro, mensagem, URL, título ou corpo. */
export interface CalendarIssue {
  kind: string;
  status?: number;
}

export interface CalendarLogger {
  warn(issue: CalendarIssue, message: string): void;
}

export interface CalendarService {
  readonly enabled: boolean;
  getWeek(mondayIso: string): Promise<CalendarEvent[]>;
}

export const disabledCalendarService: CalendarService = Object.freeze({
  enabled: false,
  async getWeek() {
    return [];
  },
});

/** Segunda (AAAA-MM-DD) → [segunda 00:00, sábado 00:00) no fuso local do servidor. */
export function weekRange(mondayIso: string): WeekRange {
  const [year, month, day] = mondayIso.split('-').map(Number) as [number, number, number];
  return { start: new Date(year, month - 1, day), end: new Date(year, month - 1, day + 5) };
}

export interface CalendarServiceOptions {
  /** Cria o cliente sob demanda (nunca no main()): falha da Apple não derruba a subida. */
  createSource: () => CalendarSource;
  log: CalendarLogger;
  nowMs?: () => number;
  parseBudget?: () => ParseBudget;
}

function issueOf(error: unknown): CalendarIssue {
  if (error instanceof CalendarFetchError) {
    return error.status === undefined ? { kind: error.kind } : { kind: error.kind, status: error.status };
  }
  if (error instanceof Error && error.name === 'XmlError') return { kind: 'xml' };
  return { kind: 'unknown' };
}

function isAuthFailure(issue: CalendarIssue): boolean {
  return issue.kind === 'http' && (issue.status === 401 || issue.status === 403);
}

/**
 * Único limite de erro da integração: criação do cliente, discovery, REPORT
 * e parse. Tudo vira 502 genérico (ou "senha recusada"), com log mínimo.
 */
export function createCalendarService(options: CalendarServiceOptions): CalendarService {
  const nowMs = options.nowMs ?? (() => Date.now());
  const budget = options.parseBudget ?? defaultParseBudget;
  const cache = new Map<string, { expires: number; events: CalendarEvent[] }>();
  const inflight = new Map<string, Promise<CalendarEvent[]>>();
  let source: CalendarSource | undefined;
  let authCooldownUntil = 0;

  async function load(mondayIso: string): Promise<CalendarEvent[]> {
    try {
      source ??= options.createSource();
      const range = weekRange(mondayIso);
      const texts = await source.fetchWeek(range);
      // Só o resultado minimizado fica em memória; o ICS bruto é descartado aqui.
      return parseWeek(texts, range, budget());
    } catch (error) {
      const issue = issueOf(error);
      if (isAuthFailure(issue)) {
        authCooldownUntil = nowMs() + AUTH_COOLDOWN_MS;
        options.log.warn(issue, 'Agenda da Apple: senha de app recusada');
        throw upstreamAuthError();
      }
      options.log.warn(issue, 'Agenda da Apple indisponível');
      throw upstreamError();
    }
  }

  return {
    enabled: true,

    async getWeek(mondayIso) {
      const now = nowMs();
      // Depois de 401/403, não insiste: evita bloquear o Apple ID por tentativas.
      if (now < authCooldownUntil) throw upstreamAuthError();

      const cached = cache.get(mondayIso);
      if (cached && cached.expires > now) return cached.events;

      const pending = inflight.get(mondayIso);
      if (pending) return pending;

      const promise = load(mondayIso)
        .then((events) => {
          cache.delete(mondayIso);
          cache.set(mondayIso, { expires: nowMs() + CACHE_TTL_MS, events });
          while (cache.size > MAX_CACHED_WEEKS) {
            const oldest = cache.keys().next().value;
            if (oldest === undefined) break;
            cache.delete(oldest);
          }
          return events;
        })
        .finally(() => {
          inflight.delete(mondayIso);
        });
      inflight.set(mondayIso, promise);
      return promise;
    },
  };
}
