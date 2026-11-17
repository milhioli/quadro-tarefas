import { dayName, type CalendarEvent } from '@quadro/shared';
import type { BoardColumn } from './board';
import { addDays, formatDayMonth, isoDate, parseIsoDate } from './calendar';

/** Evento como aparece num dia: o rótulo depende de qual pedaço do evento cai nele. */
export interface DayEvent {
  event: CalendarEvent;
  /** "09:00 – 10:00", "Dia inteiro", "até 10:00" ou "a partir de 22:00". */
  label: string;
  /** Dia inteiro (ou um dia do meio de um evento longo): vai para o topo da lista. */
  wholeDay: boolean;
}

export const EMPTY_DAY_EVENTS: ReadonlyMap<number, readonly DayEvent[]> = new Map();

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function hhmm(ms: number): string {
  const date = new Date(ms);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** "Terça, 17/11" — título do modal e nome acessível da bolinha. */
export function dayTitle(column: BoardColumn): string {
  return `${dayName(column.day)}, ${formatDayMonth(column.date)}`;
}

function nextIso(iso: string): string {
  const date = parseIsoDate(iso);
  return date ? isoDate(addDays(date, 1)) : iso;
}

/** Como o evento aparece no dia da coluna, ou null se não toca esse dia. */
export function dayEventFor(event: CalendarEvent, column: BoardColumn): DayEvent | null {
  if (event.allDay) {
    const day = isoDate(column.date);
    const end = event.end > event.start ? event.end : nextIso(event.start);
    return event.start <= day && day < end ? { event, label: 'Dia inteiro', wholeDay: true } : null;
  }

  const start = Date.parse(event.start);
  if (Number.isNaN(start)) return null;
  const parsedEnd = Date.parse(event.end);
  const end = Number.isNaN(parsedEnd) || parsedEnd < start ? start : parsedEnd;

  const civil = column.date;
  const dayStart = new Date(civil.getUTCFullYear(), civil.getUTCMonth(), civil.getUTCDate()).getTime();
  const dayEnd = new Date(civil.getUTCFullYear(), civil.getUTCMonth(), civil.getUTCDate() + 1).getTime();
  const touches = end === start ? start >= dayStart && start < dayEnd : start < dayEnd && end > dayStart;
  if (!touches) return null;

  const startsToday = start >= dayStart;
  const endsToday = end <= dayEnd;
  if (startsToday && endsToday) {
    return { event, label: end === start ? hhmm(start) : `${hhmm(start)} – ${hhmm(end)}`, wholeDay: false };
  }
  if (!startsToday && !endsToday) return { event, label: 'Dia inteiro', wholeDay: true };
  if (!startsToday) return { event, label: `até ${hhmm(end)}`, wholeDay: false };
  return { event, label: `a partir de ${hhmm(start)}`, wholeDay: false };
}

function sortStart(item: DayEvent): number {
  return item.event.allDay ? 0 : Date.parse(item.event.start);
}

/** Eventos de cada coluna (só dias com evento entram no mapa). */
export function eventsByDay(events: readonly CalendarEvent[], columns: readonly BoardColumn[]): Map<number, DayEvent[]> {
  const result = new Map<number, DayEvent[]>();
  for (const column of columns) {
    const items = events
      .map((event) => dayEventFor(event, column))
      .filter((item): item is DayEvent => item !== null)
      .sort(
        (a, b) =>
          Number(b.wholeDay) - Number(a.wholeDay) ||
          sortStart(a) - sortStart(b) ||
          a.event.title.localeCompare(b.event.title, 'pt-BR'),
      );
    if (items.length > 0) result.set(column.day, items);
  }
  return result;
}
