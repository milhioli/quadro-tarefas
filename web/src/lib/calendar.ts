/**
 * Calendário brasileiro, puro e sem fuso.
 *
 * Toda data aqui é uma "data civil": um `Date` à meia-noite UTC do dia,
 * manipulado só com os getters UTC. Assim a aritmética não sofre com
 * horário de verão nem com o fuso da máquina. A conversão do instante do
 * relógio para a data que o usuário vê acontece uma vez, em `toCivilDate`.
 */

const MS_PER_DAY = 86_400_000;

export const MONTH_NAMES: readonly string[] = Object.freeze([
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
]);

/** Indexado por getUTCDay(): 0 = domingo. */
export const WEEKDAY_NAMES: readonly string[] = Object.freeze([
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
]);

export const WEEKDAY_SHORT_NAMES: readonly string[] = Object.freeze(['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']);

export type HolidayKind = 'feriado' | 'facultativo';

export interface Holiday {
  readonly date: Date;
  readonly name: string;
  readonly kind: HolidayKind;
}

/** O Dia Nacional de Zumbi e da Consciência Negra é feriado nacional desde 2024. */
export const CONSCIENCIA_NEGRA_SINCE = 2024;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function pick(list: readonly string[], index: number): string {
  const value = list[index];
  if (value === undefined) throw new RangeError(`Índice inválido: ${index}`);
  return value;
}

/** Data civil a partir de ano, mês (1–12) e dia. Lança RangeError se não existir. */
export function civilDate(year: number, month: number, day: number): Date {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new RangeError('Data inválida');
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new RangeError(`Data inválida: ${year}-${pad2(month)}-${pad2(day)}`);
  }
  return date;
}

/** Data civil do instante, no fuso local (o dia que aparece no relógio do usuário). */
export function toCivilDate(instant: Date): Date {
  return new Date(Date.UTC(instant.getFullYear(), instant.getMonth(), instant.getDate()));
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/** 0 = domingo … 6 = sábado. */
export function dayOfWeek(date: Date): number {
  return date.getUTCDay();
}

export function sameDate(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Semana do mês (semanas de domingo a sábado; a primeira contém o dia 1). */
export function weekOfMonth(date: Date): number {
  const first = dayOfWeek(civilDate(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return Math.floor((first + date.getUTCDate() - 1) / 7) + 1;
}

/** Quantas semanas (domingo a sábado) o mês ocupa. */
export function weeksInMonth(year: number, month: number): number {
  const first = dayOfWeek(civilDate(year, month, 1));
  return Math.ceil((first + daysInMonth(year, month)) / 7);
}

/**
 * Segunda a sexta da semana (domingo a sábado) que contém `date`.
 * No domingo mostra a semana que começa; no sábado, a que termina.
 */
export function currentWorkWeek(date: Date): Date[] {
  const sunday = addDays(date, -dayOfWeek(date));
  return [1, 2, 3, 4, 5].map((offset) => addDays(sunday, offset));
}

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return civilDate(year, month, day);
}

const FIXED_HOLIDAYS: ReadonlyArray<{ month: number; day: number; name: string; since?: number }> = [
  { month: 1, day: 1, name: 'Confraternização Universal' },
  { month: 4, day: 21, name: 'Tiradentes' },
  { month: 5, day: 1, name: 'Dia do Trabalho' },
  { month: 9, day: 7, name: 'Independência do Brasil' },
  { month: 10, day: 12, name: 'Nossa Senhora Aparecida' },
  { month: 11, day: 2, name: 'Finados' },
  { month: 11, day: 15, name: 'Proclamação da República' },
  { month: 11, day: 20, name: 'Dia Nacional de Zumbi e da Consciência Negra', since: CONSCIENCIA_NEGRA_SINCE },
  { month: 12, day: 25, name: 'Natal' },
];

/** Feriados nacionais e pontos facultativos federais do ano, em ordem de data. */
export function brazilianHolidays(year: number): Holiday[] {
  const easter = easterSunday(year);
  const list: Holiday[] = FIXED_HOLIDAYS.filter((h) => h.since === undefined || year >= h.since).map((h) => ({
    date: civilDate(year, h.month, h.day),
    name: h.name,
    kind: 'feriado',
  }));
  list.push(
    { date: addDays(easter, -48), name: 'Carnaval', kind: 'facultativo' },
    { date: addDays(easter, -47), name: 'Carnaval', kind: 'facultativo' },
    { date: addDays(easter, -2), name: 'Sexta-feira Santa', kind: 'feriado' },
    { date: addDays(easter, 60), name: 'Corpus Christi', kind: 'facultativo' },
  );
  return list.sort(
    (a, b) =>
      a.date.getTime() - b.date.getTime() ||
      (a.kind === b.kind ? 0 : a.kind === 'feriado' ? -1 : 1) ||
      a.name.localeCompare(b.name, 'pt-BR'),
  );
}

export function holidayKindLabel(kind: HolidayKind): string {
  return kind === 'feriado' ? 'Feriado' : 'Ponto facultativo';
}

/** "Feriado: Proclamação da República (15/11)" — nome acessível da bolinha. */
export function holidayLabel(holiday: Holiday): string {
  return `${holidayKindLabel(holiday.kind)}: ${holiday.name} (${formatDayMonth(holiday.date)})`;
}

export function holidaysOn(date: Date): Holiday[] {
  return brazilianHolidays(date.getUTCFullYear()).filter((h) => sameDate(h.date, date));
}

/** Feriados de cada data, por `isoDate`. Funciona em semanas que atravessam o ano novo. */
export function holidaysForDates(dates: readonly Date[]): Map<string, Holiday[]> {
  const years = new Set(dates.map((d) => d.getUTCFullYear()));
  const all = [...years].flatMap((year) => brazilianHolidays(year));
  const result = new Map<string, Holiday[]>();
  for (const date of dates) {
    result.set(
      isoDate(date),
      all.filter((h) => sameDate(h.date, date)),
    );
  }
  return result;
}

/** Próximo feriado ou ponto facultativo estritamente depois de `date`. */
export function nextHoliday(date: Date): Holiday | null {
  const year = date.getUTCFullYear();
  const candidates = [...brazilianHolidays(year), ...brazilianHolidays(year + 1)];
  return candidates.find((h) => h.date.getTime() > date.getTime()) ?? null;
}

/** AAAA-MM-DD. */
export function isoDate(date: Date): string {
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** Lê AAAA-MM-DD; devolve null se o formato ou a data forem inválidos. */
export function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  try {
    return civilDate(Number(match[1]), Number(match[2]), Number(match[3]));
  } catch {
    return null;
  }
}

/** "13/11". */
export function formatDayMonth(date: Date): string {
  return `${pad2(date.getUTCDate())}/${pad2(date.getUTCMonth() + 1)}`;
}

/** "Novembro de 2026". */
export function monthLabel(date: Date): string {
  return `${pick(MONTH_NAMES, date.getUTCMonth())} de ${date.getUTCFullYear()}`;
}

/** "Semana 2 de 5". */
export function weekLabel(date: Date): string {
  return `Semana ${weekOfMonth(date)} de ${weeksInMonth(date.getUTCFullYear(), date.getUTCMonth() + 1)}`;
}

/** "Seg 09/11". */
export function formatDayHeader(date: Date): string {
  return `${pick(WEEKDAY_SHORT_NAMES, dayOfWeek(date))} ${formatDayMonth(date)}`;
}

/** "sexta-feira, 13/11". */
export function formatLongDate(date: Date): string {
  return `${pick(WEEKDAY_NAMES, dayOfWeek(date))}, ${formatDayMonth(date)}`;
}
