import ICAL from 'ical.js';
import { describe, expect, it } from 'vitest';
import { BOGUS_SAO_PAULO_VTIMEZONE, SAO_PAULO_VTIMEZONE, vcalendar } from '../../test/helpers/caldavFixtures';
import { MAX_TITLE_LENGTH, UNTITLED, cleanTitle, defaultParseBudget, eventId, parseWeek, type ParseBudget } from './parseEvents';

// Semana de segunda 16/11/2026 (00:00 local) a sábado 21/11/2026 (00:00 local).
const range = { start: new Date(2026, 10, 16), end: new Date(2026, 10, 21) };
const STAMP = 'DTSTAMP:20261101T000000Z';

const event = (uid: string, ...lines: string[]) => [`UID:${uid}@example.com`, STAMP, ...lines];
const parse = (texts: string[], budget?: ParseBudget) => parseWeek(texts, range, budget);
const titles = (texts: string[]) => parse(texts).map((e) => e.title);

describe('parseWeek — eventos simples', () => {
  it('evento com hora em UTC', () => {
    const [result] = parse([vcalendar([event('a', 'DTSTART:20261117T120000Z', 'DTEND:20261117T130000Z', 'SUMMARY:Dentista')])]);
    expect(result).toMatchObject({
      title: 'Dentista',
      start: '2026-11-17T12:00:00.000Z',
      end: '2026-11-17T13:00:00.000Z',
      allDay: false,
    });
  });

  it('evento com TZID America/Sao_Paulo usa o VTIMEZONE do próprio arquivo', () => {
    const [result] = parse([
      vcalendar([
        event('b', 'DTSTART;TZID=America/Sao_Paulo:20261117T090000', 'DTEND;TZID=America/Sao_Paulo:20261117T100000', 'SUMMARY:Reunião'),
      ]),
    ]);
    expect(result).toMatchObject({ start: '2026-11-17T12:00:00.000Z', end: '2026-11-17T13:00:00.000Z' });
  });

  it('evento de dia inteiro vira datas, com fim exclusivo', () => {
    const [result] = parse([
      vcalendar([event('c', 'DTSTART;VALUE=DATE:20261118', 'DTEND;VALUE=DATE:20261119', 'SUMMARY:Aniversário')]),
    ]);
    expect(result).toMatchObject({ title: 'Aniversário', start: '2026-11-18', end: '2026-11-19', allDay: true });
  });

  it('fora da semana não entra', () => {
    expect(titles([vcalendar([event('d', 'DTSTART:20261124T120000Z', 'DTEND:20261124T130000Z', 'SUMMARY:Depois')])])).toEqual([]);
    expect(titles([vcalendar([event('e', 'DTSTART:20261110T120000Z', 'DTEND:20261110T130000Z', 'SUMMARY:Antes')])])).toEqual([]);
  });

  it('evento que atravessa a meia-noite entra uma vez, com início e fim', () => {
    const [result] = parse([
      vcalendar([
        event('f', 'DTSTART;TZID=America/Sao_Paulo:20261119T230000', 'DTEND;TZID=America/Sao_Paulo:20261120T010000', 'SUMMARY:Plantão'),
      ]),
    ]);
    expect(result).toMatchObject({ start: '2026-11-20T02:00:00.000Z', end: '2026-11-20T04:00:00.000Z' });
  });

  it('cancelado não entra', () => {
    expect(
      titles([vcalendar([event('g', 'DTSTART:20261117T120000Z', 'DTEND:20261117T130000Z', 'STATUS:CANCELLED', 'SUMMARY:Cancelado')])]),
    ).toEqual([]);
  });

  it('ordena por início', () => {
    const result = titles([
      vcalendar([
        event('h1', 'DTSTART:20261118T120000Z', 'DTEND:20261118T130000Z', 'SUMMARY:Quarta'),
        event('h2', 'DTSTART:20261116T120000Z', 'DTEND:20261116T130000Z', 'SUMMARY:Segunda'),
      ]),
    ]);
    expect(result).toEqual(['Segunda', 'Quarta']);
  });
});

describe('parseWeek — recorrência', () => {
  const weekly = event(
    'w',
    'DTSTART;TZID=America/Sao_Paulo:20261005T090000',
    'DTEND;TZID=America/Sao_Paulo:20261005T100000',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,WE',
    'EXDATE;TZID=America/Sao_Paulo:20261116T090000',
    'SUMMARY:Academia',
  );

  it('expande dentro da semana e respeita o EXDATE', () => {
    const result = parse([vcalendar([weekly])]);
    expect(result.map((e) => [e.title, e.start])).toEqual([['Academia', '2026-11-18T12:00:00.000Z']]);
  });

  it('exceção (RECURRENCE-ID) substitui a ocorrência, inclusive movida de dia', () => {
    const moved = event(
      'w',
      'RECURRENCE-ID;TZID=America/Sao_Paulo:20261118T090000',
      'DTSTART;TZID=America/Sao_Paulo:20261119T140000',
      'DTEND;TZID=America/Sao_Paulo:20261119T150000',
      'SUMMARY:Academia (remarcada)',
    );
    const result = parse([vcalendar([weekly, moved])]);
    expect(result.map((e) => [e.title, e.start])).toEqual([['Academia (remarcada)', '2026-11-19T17:00:00.000Z']]);
  });

  it('ocorrência cancelada por exceção não entra', () => {
    const cancelled = event(
      'w',
      'RECURRENCE-ID;TZID=America/Sao_Paulo:20261118T090000',
      'DTSTART;TZID=America/Sao_Paulo:20261118T090000',
      'DTEND;TZID=America/Sao_Paulo:20261118T100000',
      'STATUS:CANCELLED',
      'SUMMARY:Academia',
    );
    expect(parse([vcalendar([weekly, cancelled])])).toEqual([]);
  });

  it('ids diferentes por ocorrência e estáveis entre leituras', () => {
    const daily = vcalendar([event('dd', 'DTSTART:20261116T120000Z', 'DTEND:20261116T123000Z', 'RRULE:FREQ=DAILY;COUNT=5', 'SUMMARY:Café')]);
    const first = parse([daily]).map((e) => e.id);
    expect(new Set(first).size).toBe(5);
    expect(parse([daily]).map((e) => e.id)).toEqual(first);
  });
});

describe('parseWeek — limites (conteúdo de terceiro)', () => {
  it.each([
    ['SECONDLY desde 1970', 'DTSTART:19700101T000000Z', 'RRULE:FREQ=SECONDLY'],
    ['MINUTELY desde 2000', 'DTSTART:20000101T000000Z', 'RRULE:FREQ=MINUTELY'],
    ['HOURLY', 'DTSTART:20261116T000000Z', 'RRULE:FREQ=HOURLY'],
    ['regra que nunca casa', 'DTSTART:20000101T000000Z', 'RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30'],
  ])('%s é descartada rápido, sem travar', (_label, dtstart, rrule) => {
    const started = performance.now();
    const result = parse([vcalendar([event('p', dtstart, rrule, 'SUMMARY:Patológica')])]);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(result).toEqual([]);
  });

  it('o limite conta as iterações desde o DTSTART (série diária antiga é pulada)', () => {
    const old = vcalendar([event('o', 'DTSTART:19900101T120000Z', 'DTEND:19900101T130000Z', 'RRULE:FREQ=DAILY', 'SUMMARY:Antiga')]);
    expect(parse([old])).toEqual([]);
    const generous: ParseBudget = { ...defaultParseBudget(), maxIterationsPerEvent: 20_000, maxMs: 10_000 };
    expect(parse([old], generous)).toHaveLength(5);
  });

  it('orçamento de tempo esgotado pula os recorrentes, mas mantém os simples', () => {
    let clock = 0;
    const budget: ParseBudget = { ...defaultParseBudget(), maxMs: 250, now: () => (clock += 100) };
    const text = vcalendar([
      event('r', 'DTSTART:20261005T120000Z', 'DTEND:20261005T130000Z', 'RRULE:FREQ=DAILY', 'SUMMARY:Recorrente'),
      event('s', 'DTSTART:20261117T150000Z', 'DTEND:20261117T160000Z', 'SUMMARY:Simples'),
    ]);
    expect(parse([text], budget).map((e) => e.title)).toEqual(['Simples']);
  });

  it('limite de eventos por semana', () => {
    const many = vcalendar(
      Array.from({ length: 10 }, (_, i) => event(`m${i}`, 'DTSTART:20261117T120000Z', 'DTEND:20261117T130000Z', `SUMMARY:E${i}`)),
    );
    expect(parse([many], { ...defaultParseBudget(), maxEvents: 3 })).toHaveLength(3);
  });

  it('objeto inválido é pulado sem derrubar a semana', () => {
    const ok = vcalendar([event('ok', 'DTSTART:20261117T120000Z', 'DTEND:20261117T130000Z', 'SUMMARY:Válido')]);
    expect(titles(['isso não é iCalendar', 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\n', ok])).toEqual(['Válido']);
  });

  it('VTIMEZONE de um convite não afeta outro VCALENDAR e nada é registrado globalmente', () => {
    const tz = 'DTSTART;TZID=America/Sao_Paulo:20261117T090000';
    const end = 'DTEND;TZID=America/Sao_Paulo:20261117T100000';
    const bogus = vcalendar([event('x', tz, end, 'SUMMARY:Convite estranho')], { timezones: [BOGUS_SAO_PAULO_VTIMEZONE] });
    const normal = vcalendar([event('y', tz, end, 'SUMMARY:Normal')], { timezones: [SAO_PAULO_VTIMEZONE] });
    const result = parse([bogus, normal]);
    expect(result.find((e) => e.title === 'Normal')?.start).toBe('2026-11-17T12:00:00.000Z');
    expect(ICAL.TimezoneService.count).toBe(0);
  });

  it('evento duplicado (mesmo objeto em dois calendários) aparece uma vez', () => {
    const text = vcalendar([event('dup', 'DTSTART:20261117T120000Z', 'DTEND:20261117T130000Z', 'SUMMARY:Duplicado')]);
    expect(titles([text, text])).toEqual(['Duplicado']);
  });
});

describe('parseWeek — minimização', () => {
  it('só id, título, início, fim e dia inteiro saem', () => {
    const text = vcalendar([
      event(
        'priv',
        'DTSTART:20261117T120000Z',
        'DTEND:20261117T130000Z',
        'SUMMARY:Consulta',
        'DESCRIPTION:Levar exames do convênio 123',
        'LOCATION:Rua das Flores 10',
        'ORGANIZER;CN=Dra. Fulana:mailto:fulana@example.com',
        'ATTENDEE;CN=Beltrano:mailto:beltrano@example.com',
        'URL:https://example.com/sala',
      ),
    ]);
    const [result] = parse([text]);
    expect(Object.keys(result ?? {}).sort()).toEqual(['allDay', 'end', 'id', 'start', 'title']);
    const json = JSON.stringify(result);
    for (const secret of ['exames', 'Flores', 'fulana', 'beltrano', 'example.com', 'priv@']) {
      expect(json).not.toContain(secret);
    }
  });
});

describe('cleanTitle e eventId', () => {
  it('apara, tira caracteres de controle e limita o tamanho', () => {
    expect(cleanTitle('  <b>Oi</b>\u0007\u0000 mundo  ')).toBe('<b>Oi</b> mundo');
    expect(cleanTitle('a'.repeat(500))).toHaveLength(MAX_TITLE_LENGTH);
    expect(cleanTitle('   ')).toBe(UNTITLED);
    expect(cleanTitle(undefined)).toBe(UNTITLED);
  });

  it('evento sem SUMMARY vira "(sem título)"', () => {
    expect(titles([vcalendar([event('n', 'DTSTART:20261117T120000Z', 'DTEND:20261117T130000Z')])])).toEqual([UNTITLED]);
  });

  it('eventId não expõe o UID', () => {
    const id = eventId('segredo@example.com', '');
    expect(id).not.toContain('segredo');
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(eventId('segredo@example.com', '20261118T090000')).not.toBe(id);
  });
});
