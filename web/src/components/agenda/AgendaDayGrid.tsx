import { SLOTS, dayName, rangeLabel, type Task } from '@quadro/shared';
import { boardLayout, cellKey, type BoardColumn } from '../../lib/board';
import { formatDayMonth } from '../../lib/calendar';
import { AgendaTaskButton } from './AgendaTaskButton';

export interface AgendaDayGridProps {
  tasks: readonly Task[];
  column: BoardColumn;
  onOpenTask: (id: number) => void;
  /** Tocar numa faixa livre: criar tarefa já com dia e horário. */
  onCreateAt: (position: { day: number; slot: number }) => void;
}

/**
 * Visualização "Dia completo": as 34 faixas; as livres criam tarefa naquele
 * horário. Uma tarefa de vários slots vira uma linha só ("05:00 – 20:00"),
 * e as faixas que ela cobre não aparecem.
 */
export function AgendaDayGrid({ tasks, column, onOpenTask, onCreateAt }: AgendaDayGridProps) {
  const { starts, covered } = boardLayout(tasks);
  return (
    <ol className="agenda-grid">
      {SLOTS.map((label, slot) => {
        const key = cellKey(column.day, slot);
        if (covered.has(key)) return null;
        const task = starts.get(key)?.task;
        return (
          <li key={slot} className={task ? 'agenda-grid__row is-filled' : 'agenda-grid__row'}>
            {task ? (
              <AgendaTaskButton task={task} timeLabel={rangeLabel(slot, task.span)} onOpen={onOpenTask} />
            ) : (
              <button
                type="button"
                className="agenda-free"
                aria-label={`Agendar em ${dayName(column.day)} ${formatDayMonth(column.date)}, ${label}`}
                onClick={() => onCreateAt({ day: column.day, slot })}
              >
                <span className="agenda-task__time" aria-hidden="true">
                  {label}
                </span>
                <span className="agenda-free__label" aria-hidden="true">
                  + livre
                </span>
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}
