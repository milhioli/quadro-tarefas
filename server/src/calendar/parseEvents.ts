import { createHash } from 'node:crypto';
import type { CalendarEvent } from '@quadro/shared';
import ICAL from 'ical.js';
import type { WeekRange } from './caldavClient';

/**
 * iCalendar de terceiro → eventos da semana, minimizados.
 * - Só título, início, fim e "dia inteiro" saem daqui (nada de descrição,
 *   local, participantes, URL ou alarmes).
 * - Fuso: o ical.js resolve o TZID pelo VTIMEZONE do próprio VCALENDAR
 *   (getTimeZoneByID); nada é registrado no TimezoneService global, então o
 *   VTIMEZONE de um convite não afeta outro.
 * - Recorrência com teto de iterações por evento (contando desde o DTSTART)
 *   e orçamento de tempo por semana; SECONDLY/MINUTELY/HOURLY são descartadas.
 * - Objeto inválido é pulado; limite estourado pula o evento, não a semana.
 */

type IcalComponent = InstanceType<typeof ICAL.Component>;
type IcalEvent = InstanceType<typeof ICAL.Event>;
type IcalTime = InstanceType<typeof ICAL.Time>;

export interface ParseBudget {
  maxMs: number;
  maxIterationsPerEvent: number;
  maxEvents: number;
  now: () => number;
}

export function defaultParseBudget(): ParseBudget {
  return { maxMs: 250, maxIterationsPerEvent: 10_000, maxEvents: 2_000, now: () => performance.now() };
}

export const MAX_TITLE_LENGTH = 200;
export const UNTITLED = '(sem título)';
const FORBIDDEN_FREQUENCIES: ReadonlySet<string> = new Set(['SECONDLY', 'MINUTELY', 'HOURLY']);
/** Uma exceção pode ter sido movida para a semana a partir de uma ocorrência posterior. */
const LOOKAHEAD_MS = 31 * 86_400_000;

export function cleanTitle(raw: unknown): string {
  if (typeof raw !== 'string') return UNTITLED;
  // eslint-disable-next-line no-control-regex -- remover caracteres de controle é o objetivo
  const cleaned = raw.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, MAX_TITLE_LENGTH) : UNTITLED;
}

/** id estável que não expõe o UID do evento. */
export function eventId(uid: string, recurrenceKey: string): string {
  return createHash('sha256').update(`${uid}\u0000${recurrenceKey}`).digest('base64url').slice(0, 22);
}

function pad(value: number, size = 2): string {
  return String(value).padStart(size, '0');
}

function dateOnly(time: IcalTime): string {
  return `${pad(time.year, 4)}-${pad(time.month)}-${pad(time.day)}`;
}

function localDateOnly(date: Date): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

interface Window {
  startMs: number;
  endMs: number;
  startDate: string;
  endDate: string;
}

function nextDay(time: IcalTime): IcalTime {
  const copy = time.clone();
  copy.adjust(1, 0, 0, 0);
  return copy;
}

function allDayBounds(start: IcalTime, end: IcalTime): [string, string] {
  const startDate = dateOnly(start);
  let endDate = end.isDate ? dateOnly(end) : dateOnly(nextDay(end));
  if (endDate <= startDate) endDate = dateOnly(nextDay(start));
  return [startDate, endDate];
}

function overlaps(start: IcalTime, end: IcalTime, window: Window): boolean {
  if (start.isDate) {
    const [startDate, endDate] = allDayBounds(start, end);
    return startDate < window.endDate && endDate > window.startDate;
  }
  const startMs = start.toJSDate().getTime();
  const endMs = Math.max(end.toJSDate().getTime(), startMs);
  if (endMs === startMs) return startMs >= window.startMs && startMs < window.endMs;
  return startMs < window.endMs && endMs > window.startMs;
}

function toEvent(item: IcalEvent, start: IcalTime, end: IcalTime, recurrenceKey: string): CalendarEvent {
  const id = eventId(String(item.uid ?? ''), recurrenceKey);
  const title = cleanTitle(item.summary);
  if (start.isDate) {
    const [startDate, endDate] = allDayBounds(start, end);
    return { id, title, start: startDate, end: endDate, allDay: true };
  }
  const startJs = start.toJSDate();
  const endJs = end.toJSDate();
  const safeEnd = endJs.getTime() < startJs.getTime() ? startJs : endJs;
  return { id, title, start: startJs.toISOString(), end: safeEnd.toISOString(), allDay: false };
}

function isCancelled(event: IcalEvent): boolean {
  return String(event.component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED';
}

function hasForbiddenFrequency(event: IcalEvent): boolean {
  return event.component
    .getAllProperties('rrule')
    .map((property) => property.getFirstValue())
    .some((value) => value instanceof ICAL.Recur && FORBIDDEN_FREQUENCIES.has(String(value.freq).toUpperCase()));
}

function parseCalendars(text: string): IcalComponent[] {
  const parsed: unknown = ICAL.parse(text);
  if (!Array.isArray(parsed)) return [];
  const roots = Array.isArray(parsed[0]) ? (parsed as unknown[]) : [parsed];
  return roots
    .map((root) => new ICAL.Component(root as never))
    .filter((component) => component.name === 'vcalendar');
}

interface Collector {
  window: Window;
  budget: ParseBudget;
  deadline: number;
  out: Map<string, CalendarEvent>;
}

function add(collector: Collector, event: CalendarEvent): void {
  if (collector.out.size < collector.budget.maxEvents) collector.out.set(event.id, event);
}

function collectEvent(event: IcalEvent, collector: Collector): void {
  const { window, budget } = collector;
  if (isCancelled(event)) return;
  const start = event.startDate;
  if (!start) return;

  if (!event.isRecurring()) {
    const end = event.endDate ?? start;
    if (overlaps(start, end, window)) {
      add(collector, toEvent(event, start, end, event.recurrenceId ? event.recurrenceId.toString() : ''));
    }
    return;
  }

  if (hasForbiddenFrequency(event)) return;
  // Orçamento esgotado: eventos recorrentes são pulados; os simples seguem (custam pouco).
  if (budget.now() > collector.deadline) return;

  const found: CalendarEvent[] = [];
  const iterator = event.iterator();
  let iterations = 0;
  for (let next = iterator.next(); next; next = iterator.next()) {
    iterations += 1;
    if (iterations > budget.maxIterationsPerEvent || budget.now() > collector.deadline) return;
    if (next.toJSDate().getTime() > window.endMs + LOOKAHEAD_MS) break;
    const details = event.getOccurrenceDetails(next);
    if (isCancelled(details.item)) continue;
    if (!overlaps(details.startDate, details.endDate, window)) continue;
    found.push(toEvent(details.item, details.startDate, details.endDate, details.recurrenceId.toString()));
  }
  for (const occurrence of found) add(collector, occurrence);
}

function collectCalendar(vcalendar: IcalComponent, collector: Collector): void {
  const masters = new Map<string, IcalEvent>();
  const exceptions: IcalEvent[] = [];
  for (const component of vcalendar.getAllSubcomponents('vevent')) {
    const event = new ICAL.Event(component);
    if (event.isRecurrenceException()) exceptions.push(event);
    else if (!masters.has(String(event.uid))) masters.set(String(event.uid), event);
  }
  const orphans: IcalEvent[] = [];
  for (const exception of exceptions) {
    const master = masters.get(String(exception.uid));
    if (master?.isRecurring()) master.relateException(exception);
    else orphans.push(exception);
  }
  for (const event of [...masters.values(), ...orphans]) {
    if (collector.out.size >= collector.budget.maxEvents) return;
    try {
      collectEvent(event, collector);
    } catch {
      // Evento malformado: pula só ele.
    }
  }
}

function sortKey(event: CalendarEvent): number {
  if (!event.allDay) return Date.parse(event.start);
  const [year, month, day] = event.start.split('-').map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1).getTime();
}

/** Eventos da semana `[range.start, range.end)` a partir dos textos iCalendar. */
export function parseWeek(texts: readonly string[], range: WeekRange, budget: ParseBudget = defaultParseBudget()): CalendarEvent[] {
  const collector: Collector = {
    window: {
      startMs: range.start.getTime(),
      endMs: range.end.getTime(),
      startDate: localDateOnly(range.start),
      endDate: localDateOnly(range.end),
    },
    budget,
    deadline: budget.now() + budget.maxMs,
    out: new Map(),
  };
  for (const text of texts) {
    if (collector.out.size >= budget.maxEvents) break;
    let calendars: IcalComponent[];
    try {
      calendars = parseCalendars(text);
    } catch {
      continue; // objeto inválido: pula, sem derrubar a semana
    }
    for (const vcalendar of calendars) collectCalendar(vcalendar, collector);
  }
  return [...collector.out.values()].sort((a, b) => sortKey(a) - sortKey(b) || a.title.localeCompare(b.title, 'pt-BR'));
}
