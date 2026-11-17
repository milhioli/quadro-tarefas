import { rangeLabel, type Task } from '@quadro/shared';
import { useId } from 'react';
import { tasksForDay } from '../../lib/agenda';
import type { BoardColumn } from '../../lib/board';
import { EMPTY_DAY_EVENTS, dayTitle, type DayEvent } from '../../lib/calendarEvents';
import { CalendarDot } from '../CalendarDot';
import { HolidayDots } from '../HolidayDots';
import { AgendaTaskButton } from './AgendaTaskButton';

export interface AgendaWeekProps {
  tasks: readonly Task[];
  columns: readonly BoardColumn[];
  onOpenTask: (id: number) => void;
  eventsByDay?: ReadonlyMap<number, readonly DayEvent[]>;
}

/** Visualização "Semana": os cinco dias em sequência, só com o que está agendado. */
export function AgendaWeek({ tasks, columns, onOpenTask, eventsByDay = EMPTY_DAY_EVENTS }: AgendaWeekProps) {
  const baseId = useId();
  return (
    <div className="agenda-week">
      {columns.map((column) => {
        const headingId = `${baseId}-${column.day}`;
        const items = tasksForDay(tasks, column.day);
        return (
          <section
            key={column.day}
            className={column.isToday ? 'agenda-week__day is-today' : 'agenda-week__day'}
            aria-labelledby={headingId}
          >
            <div className="agenda-week__header">
              <h2 id={headingId} className="agenda-week__title">
                {column.isToday ? `${column.label} · hoje` : column.label}
              </h2>
              <HolidayDots holidays={column.holidays} />
              <CalendarDot events={eventsByDay.get(column.day) ?? []} dayLabel={dayTitle(column)} />
            </div>
            {items.length === 0 ? (
              <p className="agenda-empty">Nada agendado.</p>
            ) : (
              <ul className="agenda-list">
                {items.map((task) => (
                  <li key={task.id}>
                    <AgendaTaskButton task={task} timeLabel={rangeLabel(task.slot as number, task.span)} onOpen={onOpenTask} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
