import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOME_XML, LIST_XML, PARTITION, PRINCIPAL_XML, reportXml, vcalendar } from '../../test/helpers/caldavFixtures';
import { createCaldavClient, reportBody, toCaldavUtc } from './caldavClient';
import { CalendarFetchError, createGuardedFetch, type FetchImpl } from './guardedFetch';

const range = { start: new Date('2026-11-16T03:00:00.000Z'), end: new Date('2026-11-21T03:00:00.000Z') };
const ICS = vcalendar([['UID:a@example.com', 'DTSTAMP:20261101T000000Z', 'DTSTART:20261117T120000Z', 'DTEND:20261117T130000Z', 'SUMMARY:Dentista']]);

interface Call {
  url: string;
  method: string;
  depth: string;
  body: string;
}

/** Servidor CalDAV fake, respondendo às 4 etapas com as fixtures. */
function fakeIcloud(overrides: Partial<Record<string, () => Response>> = {}) {
  const calls: Call[] = [];
  const fetchImpl: FetchImpl = async (url, init) => {
    const headers = init.headers as Record<string, string>;
    calls.push({ url, method: String(init.method), depth: headers.Depth ?? '', body: String(init.body) });
    const override = overrides[url];
    if (override) return override();
    if (url === 'https://caldav.icloud.com/') return new Response(PRINCIPAL_XML, { status: 207 });
    if (url === 'https://caldav.icloud.com/000000000/principal/') return new Response(HOME_XML, { status: 207 });
    if (url === `${PARTITION}/000000000/calendars/`) return new Response(LIST_XML, { status: 207 });
    if (url.startsWith(`${PARTITION}/000000000/calendars/`)) return new Response(reportXml([ICS]), { status: 207 });
    return new Response('não encontrado', { status: 404 });
  };
  const davFetch = createGuardedFetch({ authorization: () => 'Basic eA==', fetch: fetchImpl });
  return { calls, davFetch };
}

let globalFetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  // Nenhum teste pode falar com a rede de verdade.
  globalFetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('rede real chamada no teste');
  });
});
afterEach(() => {
  expect(globalFetchSpy).not.toHaveBeenCalled();
  globalFetchSpy.mockRestore();
});

describe('reportBody e toCaldavUtc', () => {
  it('formata o time-range em UTC', () => {
    expect(toCaldavUtc(range.start)).toBe('20261116T030000Z');
    const body = reportBody(range);
    expect(body).toContain('<c:time-range start="20261116T030000Z" end="20261121T030000Z"/>');
    expect(body).toContain('<c:comp-filter name="VEVENT">');
  });
});

describe('createCaldavClient', () => {
  it('descobre principal e home, lista os calendários de eventos e busca a semana', async () => {
    const { calls, davFetch } = fakeIcloud();
    const client = createCaldavClient(davFetch, { calendarNames: [] });
    const texts = await client.fetchWeek(range);

    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain('SUMMARY:Dentista');
    expect(calls.map((c) => [c.method, c.depth, c.url])).toEqual([
      ['PROPFIND', '0', 'https://caldav.icloud.com/'],
      ['PROPFIND', '0', 'https://caldav.icloud.com/000000000/principal/'],
      ['PROPFIND', '1', `${PARTITION}/000000000/calendars/`],
      ['REPORT', '1', `${PARTITION}/000000000/calendars/pessoal/`],
      ['REPORT', '1', `${PARTITION}/000000000/calendars/trabalho/`],
    ]);
    expect(calls[3]?.body).toContain('start="20261116T030000Z"');
  });

  it('ignora coleções que não são calendário e calendários sem VEVENT', async () => {
    const { davFetch } = fakeIcloud();
    const calendars = await createCaldavClient(davFetch, { calendarNames: [] }).listCalendars();
    expect(calendars.map((c) => c.name)).toEqual(['Pessoal', 'Trabalho']);
  });

  it('filtra por nome (sem diferenciar maiúsculas)', async () => {
    const { calls, davFetch } = fakeIcloud();
    await createCaldavClient(davFetch, { calendarNames: ['pessoal'] }).fetchWeek(range);
    expect(calls.filter((c) => c.method === 'REPORT').map((c) => c.url)).toEqual([`${PARTITION}/000000000/calendars/pessoal/`]);
  });

  it('respeita o máximo de calendários', async () => {
    const { calls, davFetch } = fakeIcloud();
    await createCaldavClient(davFetch, { calendarNames: [], maxCalendars: 1 }).fetchWeek(range);
    expect(calls.filter((c) => c.method === 'REPORT')).toHaveLength(1);
  });

  it('reaproveita a descoberta entre semanas', async () => {
    const { calls, davFetch } = fakeIcloud();
    const client = createCaldavClient(davFetch, { calendarNames: ['Pessoal'] });
    await client.fetchWeek(range);
    await client.fetchWeek(range);
    expect(calls.filter((c) => c.url === 'https://caldav.icloud.com/')).toHaveLength(1);
  });

  it('home em host fora do allowlist é recusado', async () => {
    const evilHome = HOME_XML.replace(`${PARTITION}:443`, 'https://evil.example.com');
    const { calls, davFetch } = fakeIcloud({
      'https://caldav.icloud.com/000000000/principal/': () => new Response(evilHome, { status: 207 }),
    });
    const error = await createCaldavClient(davFetch, { calendarNames: [] }).fetchWeek(range).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CalendarFetchError);
    expect((error as CalendarFetchError).kind).toBe('blocked-url');
    expect(calls.some((c) => c.url.includes('evil'))).toBe(false);
  });

  it('href de calendário em host fora do allowlist é recusado', async () => {
    const evilList = LIST_XML.replace(`${PARTITION}/000000000/calendars/trabalho/`, 'https://evil.example.com/x/');
    const { davFetch } = fakeIcloud({
      [`${PARTITION}/000000000/calendars/`]: () => new Response(evilList, { status: 207 }),
    });
    await expect(createCaldavClient(davFetch, { calendarNames: [] }).listCalendars()).rejects.toMatchObject({
      kind: 'blocked-url',
    });
  });

  it('401 vira erro http com status, para o serviço tratar como senha recusada', async () => {
    const { davFetch } = fakeIcloud({ 'https://caldav.icloud.com/': () => new Response('', { status: 401 }) });
    await expect(createCaldavClient(davFetch, { calendarNames: [] }).fetchWeek(range)).rejects.toMatchObject({
      kind: 'http',
      status: 401,
    });
  });

  it('resposta com DOCTYPE é recusada', async () => {
    const withDoctype = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]>${PRINCIPAL_XML.replace(/^<\?xml[^>]*>/, '')}`;
    const { davFetch } = fakeIcloud({ 'https://caldav.icloud.com/': () => new Response(withDoctype, { status: 207 }) });
    await expect(createCaldavClient(davFetch, { calendarNames: [] }).fetchWeek(range)).rejects.toThrow('DOCTYPE');
  });
});
