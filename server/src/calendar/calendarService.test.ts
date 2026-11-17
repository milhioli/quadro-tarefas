import { describe, expect, it, vi } from 'vitest';
import { vcalendar } from '../../test/helpers/caldavFixtures';
import type { CalendarSource } from './caldavClient';
import {
  AUTH_COOLDOWN_MS,
  CACHE_TTL_MS,
  MAX_CACHED_WEEKS,
  UPSTREAM_AUTH_MESSAGE,
  UPSTREAM_MESSAGE,
  createCalendarService,
  disabledCalendarService,
  weekRange,
  type CalendarIssue,
} from './calendarService';
import { CalendarFetchError } from './guardedFetch';

const MONDAY = '2026-11-16';
const ICS = vcalendar([
  ['UID:a@example.com', 'DTSTAMP:20261101T000000Z', 'DTSTART:20261117T120000Z', 'DTEND:20261117T130000Z', 'SUMMARY:Dentista'],
]);

function setup(fetchWeek: CalendarSource['fetchWeek'] = async () => [ICS]) {
  let now = 1_000_000;
  const source = { fetchWeek: vi.fn(fetchWeek) };
  const createSource = vi.fn(() => source);
  const logs: Array<{ issue: CalendarIssue; message: string }> = [];
  const service = createCalendarService({
    createSource,
    log: { warn: (issue, message) => logs.push({ issue, message }) },
    nowMs: () => now,
  });
  return {
    service,
    source,
    createSource,
    logs,
    advance(ms: number) {
      now += ms;
    },
  };
}

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: { code?: string; statusCode?: number; message?: string }) => `${error.statusCode} ${error.code} ${error.message}`,
  );

describe('weekRange', () => {
  it('segunda 00:00 até sábado 00:00, no fuso local', () => {
    const range = weekRange(MONDAY);
    expect([range.start.getFullYear(), range.start.getMonth(), range.start.getDate(), range.start.getHours()]).toEqual([2026, 10, 16, 0]);
    expect([range.end.getDate(), range.end.getDay()]).toEqual([21, 6]);
  });
});

describe('disabledCalendarService', () => {
  it('desligado e sem eventos', async () => {
    expect(disabledCalendarService.enabled).toBe(false);
    await expect(disabledCalendarService.getWeek(MONDAY)).resolves.toEqual([]);
  });
});

describe('createCalendarService', () => {
  it('cria o cliente só no primeiro uso e devolve os eventos minimizados', async () => {
    const { service, createSource } = setup();
    expect(createSource).not.toHaveBeenCalled();
    const events = await service.getWeek(MONDAY);
    expect(events.map((e) => e.title)).toEqual(['Dentista']);
    expect(createSource).toHaveBeenCalledTimes(1);
  });

  it('cache de 5 minutos por semana', async () => {
    const { service, source, advance } = setup();
    await service.getWeek(MONDAY);
    advance(CACHE_TTL_MS - 1);
    await service.getWeek(MONDAY);
    expect(source.fetchWeek).toHaveBeenCalledTimes(1);
    advance(2);
    await service.getWeek(MONDAY);
    expect(source.fetchWeek).toHaveBeenCalledTimes(2);
  });

  it('une pedidos simultâneos da mesma semana', async () => {
    let release: (texts: string[]) => void = () => {};
    const { service, source } = setup(() => new Promise((resolve) => (release = resolve)));
    const a = service.getWeek(MONDAY);
    const b = service.getWeek(MONDAY);
    release([ICS]);
    expect(await a).toEqual(await b);
    expect(source.fetchWeek).toHaveBeenCalledTimes(1);
  });

  it(`guarda no máximo ${MAX_CACHED_WEEKS} semanas`, async () => {
    const { service, source } = setup(async () => []);
    const mondays = Array.from({ length: MAX_CACHED_WEEKS + 1 }, (_, i) => {
      const date = new Date(Date.UTC(2026, 10, 16 + i * 7));
      return date.toISOString().slice(0, 10);
    });
    for (const monday of mondays) await service.getWeek(monday);
    await service.getWeek(mondays[0] as string);
    expect(source.fetchWeek).toHaveBeenCalledTimes(MAX_CACHED_WEEKS + 2);
  });

  it('erro vira 502 genérico, não entra no cache e o log só tem tipo e status', async () => {
    const marker = 'MARCADOR-SECRETO-https://p00-caldav.icloud.com/000000000/';
    const { service, source, logs } = setup(async () => {
      throw new CalendarFetchError('http', 500);
    });
    expect(await codeOf(service.getWeek(MONDAY))).toBe(`502 UPSTREAM ${UPSTREAM_MESSAGE}`);
    expect(await codeOf(service.getWeek(MONDAY))).toBe(`502 UPSTREAM ${UPSTREAM_MESSAGE}`);
    expect(source.fetchWeek).toHaveBeenCalledTimes(2);
    expect(logs[0]).toEqual({ issue: { kind: 'http', status: 500 }, message: 'Agenda da Apple indisponível' });
    expect(JSON.stringify(logs)).not.toContain(marker);
  });

  it('erro qualquer (com detalhe sensível) não vaza para o log nem para a resposta', async () => {
    const marker = 'DESCRIPTION:consulta-sigilosa https://p00-caldav.icloud.com/000000000/x';
    const { service, logs } = setup(async () => {
      throw new Error(marker);
    });
    const error = await service.getWeek(MONDAY).catch((e: unknown) => e);
    expect(JSON.stringify(error)).not.toContain('sigilosa');
    expect(String((error as Error).message)).toBe(UPSTREAM_MESSAGE);
    expect(logs).toEqual([{ issue: { kind: 'unknown' }, message: 'Agenda da Apple indisponível' }]);
  });

  it('falha ao criar o cliente também é tratada aqui', async () => {
    let now = 0;
    const logs: CalendarIssue[] = [];
    const service = createCalendarService({
      createSource: () => {
        throw new Error('detalhe interno');
      },
      log: { warn: (issue) => logs.push(issue) },
      nowMs: () => now++,
    });
    expect(await codeOf(service.getWeek(MONDAY))).toContain('502 UPSTREAM');
    expect(logs).toEqual([{ kind: 'unknown' }]);
  });

  it('ICS inválido é pulado sem erro', async () => {
    const { service } = setup(async () => ['lixo', ICS]);
    await expect(service.getWeek(MONDAY)).resolves.toHaveLength(1);
  });

  it('senha recusada (401/403): mensagem própria e pausa de 15 minutos sem chamar a Apple', async () => {
    const { service, source, logs, advance } = setup(async () => {
      throw new CalendarFetchError('http', 401);
    });
    expect(await codeOf(service.getWeek(MONDAY))).toBe(`502 UPSTREAM_AUTH ${UPSTREAM_AUTH_MESSAGE}`);
    advance(AUTH_COOLDOWN_MS - 1);
    expect(await codeOf(service.getWeek('2026-11-23'))).toBe(`502 UPSTREAM_AUTH ${UPSTREAM_AUTH_MESSAGE}`);
    expect(source.fetchWeek).toHaveBeenCalledTimes(1);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.issue).toEqual({ kind: 'http', status: 401 });

    advance(2);
    await service.getWeek(MONDAY).catch(() => undefined);
    expect(source.fetchWeek).toHaveBeenCalledTimes(2);
  });

  it('403 também conta como senha recusada', async () => {
    const { service } = setup(async () => {
      throw new CalendarFetchError('http', 403);
    });
    expect(await codeOf(service.getWeek(MONDAY))).toContain('UPSTREAM_AUTH');
  });
});
