import { SLOTS, dayName, type Task } from '@quadro/shared';
import { cellKey, type BoardColumn } from '../lib/board';
import { formatDayMonth } from '../lib/calendar';
import { EMPTY_DAY_EVENTS, dayTitle, type DayEvent } from '../lib/calendarEvents';
import { BoardCell } from './BoardCell';
import { CalendarDot } from './CalendarDot';
import { HolidayDots } from './HolidayDots';

export interface BoardProps {
  columns: readonly BoardColumn[];
  tasksByCell: ReadonlyMap<string, Task>;
  onOpenTask: (id: number) => void;
  /** Eventos da agenda da Apple por dia (bolinha roxa no cabeçalho). */
  eventsByDay?: ReadonlyMap<number, readonly DayEvent[]>;
}

/** Quadro da semana: colunas segunda a sexta, linhas de 30 min (05:00 – 22:00). */
export function Board({ columns, tasksByCell, onOpenTask, eventsByDay = EMPTY_DAY_EVENTS }: BoardProps) {
  return (
    <section className="board" aria-label="Quadro da semana">
      <div className="board__scroll">
        <table className="board__table">
          <caption className="visually-hidden">Quadro semanal de segunda a sexta, das 05:00 às 22:00</caption>
          <thead>
            <tr>
              <th scope="col" className="board__corner">
                Horário
              </th>
              {columns.map((column) => (
                <th
                  key={column.day}
                  scope="col"
                  className={column.isToday ? 'board__day is-today' : 'board__day'}
                  aria-current={column.isToday ? 'date' : undefined}
                >
                  <span className="board__day-head">
                    <span className="board__day-label">{column.label}</span>
                    {/* Uma bolinha por feriado; clicar abre o modal com os feriados do dia. */}
                    <HolidayDots holidays={column.holidays} />
                    <CalendarDot events={eventsByDay.get(column.day) ?? []} dayLabel={dayTitle(column)} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SLOTS.map((slotText, slot) => (
              <tr key={slot}>
                <th scope="row" className="board__slot">
                  {slotText}
                </th>
                {columns.map((column) => (
                  <BoardCell
                    key={column.day}
                    day={column.day}
                    slot={slot}
                    label={`${dayName(column.day)} ${formatDayMonth(column.date)}, ${slotText}`}
                    task={tasksByCell.get(cellKey(column.day, slot))}
                    isToday={column.isToday}
                    onOpenTask={onOpenTask}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
