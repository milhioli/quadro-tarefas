import type { Task } from '@quadro/shared';
import { currentWorkWeek, formatDayHeader, holidaysForDates, isoDate, sameDate, type Holiday } from './calendar';

export interface BoardColumn {
  /** 0 = segunda … 4 = sexta (mesma numeração do banco). */
  day: number;
  date: Date;
  /** "Seg 09/11". */
  label: string;
  isToday: boolean;
  holidays: Holiday[];
}

/** Colunas do quadro para a semana útil que contém `today`. */
export function boardColumns(today: Date): BoardColumn[] {
  const dates = currentWorkWeek(today);
  const holidays = holidaysForDates(dates);
  return dates.map((date, day) => ({
    day,
    date,
    label: formatDayHeader(date),
    isToday: sameDate(date, today),
    holidays: holidays.get(isoDate(date)) ?? [],
  }));
}

export function cellKey(day: number, slot: number): string {
  return `${day}:${slot}`;
}

export function isOnBoard(task: Task): boolean {
  return task.day !== null && task.slot !== null;
}

/** Tarefas do deck, na ordem do deck. */
export function deckTasks(tasks: readonly Task[]): Task[] {
  return tasks
    .filter((task) => !isOnBoard(task))
    .sort((a, b) => (a.deckOrder ?? 0) - (b.deckOrder ?? 0) || a.id - b.id);
}

/** Tarefas do quadro, indexadas por `cellKey(day, slot)`. */
export function placedTasksByCell(tasks: readonly Task[]): Map<string, Task> {
  const map = new Map<string, Task>();
  for (const task of tasks) {
    if (task.day !== null && task.slot !== null) map.set(cellKey(task.day, task.slot), task);
  }
  return map;
}
