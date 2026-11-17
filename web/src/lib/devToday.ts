import { parseIsoDate } from './calendar';
import type { Clock } from './clock';

export const DEV_TODAY_PARAM = 'hoje';

/** Lê `?hoje=AAAA-MM-DD`; devolve null se ausente ou inválido. */
export function devTodayFromSearch(search: string): Date | null {
  const value = new URLSearchParams(search).get(DEV_TODAY_PARAM);
  return value ? parseIsoDate(value) : null;
}

/**
 * Só em desenvolvimento: `?hoje=AAAA-MM-DD` simula a data, fixando o relógio
 * ao meio-dia local desse dia. Fora de dev, ou com data inválida, usa `base`.
 */
export function resolveClock(search: string, isDev: boolean, base: Clock): Clock {
  if (!isDev) return base;
  const date = devTodayFromSearch(search);
  if (!date) return base;
  const instant = new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12).getTime();
  return () => new Date(instant);
}
