import { calendarWeekQuerySchema, type CalendarWeekResponse } from '@quadro/shared';
import type { FastifyInstance } from 'fastify';
import type { CalendarService } from '../calendar/calendarService';
import type { Now } from '../clock';
import { HttpError, forbidden } from '../http/errors';
import { hasClientHeader } from '../http/guard';
import { validate } from '../http/validate';

/** A semana pedida precisa estar a até ~1 ano da data do servidor. */
export const MAX_WEEK_DISTANCE_MS = 366 * 86_400_000;

export function isWithinRange(mondayIso: string, now: Date): boolean {
  const [year, month, day] = mondayIso.split('-').map(Number) as [number, number, number];
  const monday = new Date(year, month - 1, day).getTime();
  return Math.abs(monday - now.getTime()) <= MAX_WEEK_DISTANCE_MS;
}

/**
 * GET /api/calendar/events?week=AAAA-MM-DD (segunda-feira).
 * É a única GET com efeito externo (chamada autenticada à Apple), então
 * também exige X-Quadro-Client: um <img src> de outro site não dispara nada.
 */
export function registerCalendarRoutes(app: FastifyInstance, service: CalendarService, now: Now): void {
  app.get(
    '/api/calendar/events',
    {
      preHandler: async (request) => {
        if (!hasClientHeader(request)) throw forbidden();
      },
    },
    async (request): Promise<CalendarWeekResponse> => {
      const { week } = validate(calendarWeekQuerySchema, request.query);
      if (!isWithinRange(week, now())) {
        throw new HttpError(400, 'VALIDATION', 'Semana fora do intervalo permitido');
      }
      if (!service.enabled) return { enabled: false, events: [] };
      return { enabled: true, events: await service.getWeek(week) };
    },
  );
}
