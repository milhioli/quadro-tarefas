import { useRef, type KeyboardEvent } from 'react';
import type { BoardColumn } from '../../lib/board';
import { EMPTY_DAY_EVENTS, dayTitle, type DayEvent } from '../../lib/calendarEvents';
import { CalendarDot } from '../CalendarDot';
import { HolidayDots } from '../HolidayDots';

export function dayTabId(prefix: string, day: number): string {
  return `${prefix}-tab-${day}`;
}

export interface DayTabsProps {
  columns: readonly BoardColumn[];
  selected: number;
  onSelect: (day: number) => void;
  /** id do tabpanel que as abas controlam. */
  panelId: string;
  idPrefix: string;
  eventsByDay?: ReadonlyMap<number, readonly DayEvent[]>;
}

/** Abas Seg–Sex (padrão de abas: ← → Home End trocam o dia). */
export function DayTabs({ columns, selected, onSelect, panelId, idPrefix, eventsByDay = EMPTY_DAY_EVENTS }: DayTabsProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const last = columns.length - 1;
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = index === last ? 0 : index + 1;
        break;
      case 'ArrowLeft':
        next = index === 0 ? last : index - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    const column = columns[next];
    if (!column) return;
    onSelect(column.day);
    refs.current[next]?.focus();
  }

  return (
    <div role="tablist" aria-label="Dia da semana" className="day-tabs">
      {columns.map((column, index) => {
        const isSelected = column.day === selected;
        const holidayCount = column.holidays.length;
        const dayEvents = eventsByDay.get(column.day) ?? [];
        return (
          <button
            key={column.day}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={dayTabId(idPrefix, column.day)}
            aria-selected={isSelected}
            aria-controls={panelId}
            tabIndex={isSelected ? 0 : -1}
            className={column.isToday ? 'day-tab is-today' : 'day-tab'}
            onClick={() => onSelect(column.day)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            <span className="day-tab__label">{column.label}</span>
            {column.isToday ? (
              <>
                {' '}
                <span className="day-tab__today">hoje</span>
              </>
            ) : null}
            {/* Dentro da aba a bolinha é só visual (botão dentro de botão é inválido). */}
            <HolidayDots holidays={column.holidays} decorative />
            {holidayCount > 0 ? (
              <span className="visually-hidden">{holidayCount === 1 ? ', 1 feriado' : `, ${holidayCount} feriados`}</span>
            ) : null}
            <CalendarDot events={dayEvents} dayLabel={dayTitle(column)} decorative />
            {dayEvents.length > 0 ? <span className="visually-hidden">, com agenda</span> : null}
          </button>
        );
      })}
    </div>
  );
}
