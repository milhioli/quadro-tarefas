import { useEffect, useState } from 'react';
import { sameDate, toCivilDate } from './calendar';
import type { Clock } from './clock';

export const TODAY_REFRESH_MS = 60_000;

/**
 * Data civil de hoje. Relê o relógio a cada `refreshMs` e quando a aba volta
 * a ficar visível, para virar o dia sozinho. Enquanto o dia não muda, devolve
 * a mesma referência (não provoca novas renderizações).
 */
export function useToday(clock: Clock, refreshMs: number = TODAY_REFRESH_MS): Date {
  const [today, setToday] = useState(() => toCivilDate(clock()));

  useEffect(() => {
    const refresh = (): void => {
      const next = toCivilDate(clock());
      setToday((previous) => (sameDate(previous, next) ? previous : next));
    };
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') refresh();
    };

    refresh();
    const timer = window.setInterval(refresh, refreshMs);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [clock, refreshMs]);

  return today;
}
