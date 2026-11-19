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
 * - Tem efeito externo (chamada autenticada à Apple), então também exige
 *   X-Quadro-Client: um <img src> de outro site não dispara nada. As outras
 *   GETs com efeito externo são as navegações do login Google, que não podem
 *   exigir o header.
 * - Fase 2a: a credencial da agenda é global (a do dono do .env). Só o admin
 *   (role lido do banco) recebe os eventos; os demais recebem `enabled:false`
 *   sem nenhuma chamada à Apple. A agenda por pessoa é a Fase 4.
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
      if (!service.enabled || request.user?.role !== 'admin') return { enabled: false, events: [] };
      return { enabled: true, events: await service.getWeek(week) };
    },
  );
}
