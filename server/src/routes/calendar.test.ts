import type { CalendarEvent } from '@quadro/shared';
import type { InjectOptions } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../test/helpers/testApp';
import { upstreamAuthError, upstreamError, type CalendarService } from '../calendar/calendarService';
import { isWithinRange } from './calendar';

const EVENT: CalendarEvent = {
  id: 'abc',
  title: 'Dentista',
  start: '2026-11-17T12:00:00.000Z',
  end: '2026-11-17T13:00:00.000Z',
  allDay: false,
};

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const get = (app: TestApp, url: string, headers: Record<string, string> = {}) =>
  app.raw({
    method: 'GET',
    url,
    headers: { host: '127.0.0.1:3001', 'x-quadro-client': '1', cookie: app.cookie, ...headers },
  } as InjectOptions);

function enabled(getWeek: CalendarService['getWeek']): () => CalendarService {
  return () => ({ enabled: true, getWeek });
}

describe('GET /api/calendar/events', () => {
  it('desligada por padrão: enabled false e sem eventos', async () => {
    t = await createTestApp();
    const res = await get(t, '/api/calendar/events?week=2026-11-16');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: false, events: [] });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('ligada: devolve os eventos da semana pedida', async () => {
    const getWeek = vi.fn(async () => [EVENT]);
    t = await createTestApp({ calendar: enabled(getWeek) });
    const res = await get(t, '/api/calendar/events?week=2026-11-16');
    expect(res.json()).toEqual({ enabled: true, events: [EVENT] });
    expect(getWeek).toHaveBeenCalledWith('2026-11-16');
  });

  it('quem não é admin recebe enabled:false, sem nenhuma chamada à Apple (a credencial é do dono do .env)', async () => {
    const getWeek = vi.fn(async () => [EVENT]);
    t = await createTestApp({ calendar: enabled(getWeek) });
    const ana = await t.signIn('ana@example.com', { username: 'ana', displayName: 'Ana' });
    const res = await t.raw({
      method: 'GET',
      url: '/api/calendar/events?week=2026-11-16',
      headers: { host: '127.0.0.1:3001', 'x-quadro-client': '1', cookie: ana.cookie },
    } as InjectOptions);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: false, events: [] });
    expect(getWeek).not.toHaveBeenCalled();
  });

  it('sem sessão, 401 e nenhuma chamada à Apple', async () => {
    const getWeek = vi.fn(async () => [EVENT]);
    t = await createTestApp({ calendar: enabled(getWeek), signInAsAdmin: false });
    const res = await t.raw({
      method: 'GET',
      url: '/api/calendar/events?week=2026-11-16',
      headers: { host: '127.0.0.1:3001', 'x-quadro-client': '1' },
    } as InjectOptions);
    expect(res.statusCode).toBe(401);
    expect(getWeek).not.toHaveBeenCalled();
  });

  it('exige X-Quadro-Client mesmo sendo GET', async () => {
    const getWeek = vi.fn(async () => [EVENT]);
    t = await createTestApp({ calendar: enabled(getWeek) });
    const res = await t.raw({
      method: 'GET',
      url: '/api/calendar/events?week=2026-11-16',
      headers: { host: '127.0.0.1:3001', cookie: t.cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(getWeek).not.toHaveBeenCalled();
  });

  it.each([
    ['terça-feira', '?week=2026-11-17'],
    ['data inexistente', '?week=2026-02-30'],
    ['formato errado', '?week=16/11/2026'],
    ['sem semana', ''],
    ['parâmetro extra', '?week=2026-11-16&x=1'],
    ['semana repetida', '?week=2026-11-16&week=2026-11-23'],
    ['mais de 1 ano no futuro', '?week=2028-01-03'],
    ['mais de 1 ano no passado', '?week=2025-06-02'],
  ])('%s dá 400 sem chamar a Apple', async (_label, query) => {
    const getWeek = vi.fn(async () => [EVENT]);
    t = await createTestApp({ calendar: enabled(getWeek) });
    const res = await get(t, `/api/calendar/events${query}`);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'VALIDATION' } });
    expect(getWeek).not.toHaveBeenCalled();
  });

  it('falha da Apple vira 502 genérico', async () => {
    t = await createTestApp({
      calendar: enabled(async () => {
        throw upstreamError();
      }),
    });
    const res = await get(t, '/api/calendar/events?week=2026-11-16');
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: { code: 'UPSTREAM', message: 'Não foi possível ler a agenda da Apple' } });
  });

  it('senha recusada vira 502 com mensagem própria', async () => {
    t = await createTestApp({
      calendar: enabled(async () => {
        throw upstreamAuthError();
      }),
    });
    const res = await get(t, '/api/calendar/events?week=2026-11-16');
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: { code: 'UPSTREAM_AUTH' } });
  });

  it('erro inesperado no serviço não vaza detalhes', async () => {
    t = await createTestApp({
      calendar: enabled(async () => {
        throw new Error('SUMMARY:consulta-sigilosa https://p00-caldav.icloud.com/000000000/');
      }),
    });
    const res = await get(t, '/api/calendar/events?week=2026-11-16');
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toMatch(/sigilosa|icloud/);
  });

  it('Host estranho continua barrado pelo guard', async () => {
    t = await createTestApp();
    const res = await get(t, '/api/calendar/events?week=2026-11-16', { host: 'evil.com:3001' });
    expect(res.statusCode).toBe(403);
  });
});

describe('isWithinRange', () => {
  const now = new Date(2026, 10, 13, 12);
  it('aceita até ~1 ano para os dois lados', () => {
    expect(isWithinRange('2026-11-16', now)).toBe(true);
    expect(isWithinRange('2027-11-08', now)).toBe(true);
    expect(isWithinRange('2025-11-17', now)).toBe(true);
    expect(isWithinRange('2027-12-27', now)).toBe(false);
    expect(isWithinRange('2025-10-06', now)).toBe(false);
  });
});
