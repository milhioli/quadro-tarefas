import type { CalendarEvent } from '@quadro/shared';
import { describe, expect, it } from 'vitest';
import { boardColumns } from './board';
import { parseIsoDate } from './calendar';
import { EMPTY_DAY_EVENTS, dayEventFor, dayTitle, eventsByDay } from './calendarEvents';

// Semana de 16 a 20/11/2026 (hoje: terça, 17/11).
const columns = boardColumns(parseIsoDate('2026-11-17') as Date);
const col = (day: number) => columns[day] as (typeof columns)[number];

/** Instante ISO a partir de horário local, para os rótulos não dependerem do fuso da máquina. */
const local = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).toISOString();

const timed = (id: string, title: string, start: string, end: string): CalendarEvent => ({ id, title, start, end, allDay: false });
const allDay = (id: string, title: string, start: string, end: string): CalendarEvent => ({ id, title, start, end, allDay: true });

describe('dayEventFor', () => {
  it('evento no próprio dia: "início – fim"', () => {
    expect(dayEventFor(timed('a', 'Dentista', local(17, 9), local(17, 10, 30)), col(1))).toEqual({
      event: expect.objectContaining({ id: 'a' }),
      label: '09:00 – 10:30',
      wholeDay: false,
    });
  });

  it('evento sem duração mostra só o horário', () => {
    expect(dayEventFor(timed('b', 'Lembrete', local(17, 8), local(17, 8)), col(1))?.label).toBe('08:00');
  });

  it('não toca outro dia', () => {
    expect(dayEventFor(timed('c', 'X', local(17, 9), local(17, 10)), col(2))).toBeNull();
  });

  it('atravessa a meia-noite: "a partir de" num dia e "até" no outro', () => {
    const night = timed('d', 'Plantão', local(19, 22), local(20, 2));
    expect(dayEventFor(night, col(3))?.label).toBe('a partir de 22:00');
    expect(dayEventFor(night, col(4))?.label).toBe('até 02:00');
  });

  it('dia do meio de um evento longo é "Dia inteiro"', () => {
    const trip = timed('e', 'Viagem', local(16, 18), local(18, 9));
    expect(dayEventFor(trip, col(1))).toMatchObject({ label: 'Dia inteiro', wholeDay: true });
  });

  it('terminar exatamente à meia-noite não aparece no dia seguinte', () => {
    const late = timed('f', 'Show', local(18, 23), local(19, 0));
    expect(dayEventFor(late, col(2))?.label).toBe('23:00 – 00:00');
    expect(dayEventFor(late, col(3))).toBeNull();
  });

  it('dia inteiro usa as datas, com fim exclusivo', () => {
    const conf = allDay('g', 'Congresso', '2026-11-18', '2026-11-20');
    expect(dayEventFor(conf, col(1))).toBeNull();
    expect(dayEventFor(conf, col(2))).toMatchObject({ label: 'Dia inteiro', wholeDay: true });
    expect(dayEventFor(conf, col(3))?.label).toBe('Dia inteiro');
    expect(dayEventFor(conf, col(4))).toBeNull();
  });

  it('dia inteiro sem fim válido vale um dia', () => {
    expect(dayEventFor(allDay('h', 'Folga', '2026-11-20', '2026-11-20'), col(4))?.label).toBe('Dia inteiro');
  });

  it('data inválida é ignorada', () => {
    expect(dayEventFor(timed('i', 'Quebrado', 'não é data', 'x'), col(0))).toBeNull();
  });
});

describe('eventsByDay', () => {
  it('agrupa por dia, com dia inteiro no topo e depois por horário', () => {
    const events = [
      timed('1', 'Almoço', local(17, 12), local(17, 13)),
      allDay('2', 'Aniversário', '2026-11-17', '2026-11-18'),
      timed('3', 'Café', local(17, 8), local(17, 8, 30)),
      timed('4', 'Quinta', local(19, 10), local(19, 11)),
    ];
    const map = eventsByDay(events, columns);
    expect(map.get(1)?.map((item) => [item.event.title, item.label])).toEqual([
      ['Aniversário', 'Dia inteiro'],
      ['Café', '08:00 – 08:30'],
      ['Almoço', '12:00 – 13:00'],
    ]);
    expect(map.get(3)?.map((item) => item.event.title)).toEqual(['Quinta']);
    expect(map.has(0)).toBe(false);
  });

  it('sem eventos, mapa vazio', () => {
    expect(eventsByDay([], columns).size).toBe(0);
    expect(EMPTY_DAY_EVENTS.size).toBe(0);
  });
});

describe('dayTitle', () => {
  it('nome do dia e data', () => {
    expect(dayTitle(col(1))).toBe('Terça, 17/11');
  });
});
