import { SLOTS, dayName, type Task } from '@quadro/shared';
import { cellKey, placedTasksByCell, type BoardColumn } from '../../lib/board';
import { formatDayMonth } from '../../lib/calendar';
import { AgendaTaskButton } from './AgendaTaskButton';

export interface AgendaDayGridProps {
  tasks: readonly Task[];
  column: BoardColumn;
  onOpenTask: (id: number) => void;
  /** Tocar numa faixa livre: criar tarefa já com dia e horário. */
  onCreateAt: (position: { day: number; slot: number }) => void;
}

/** Visualização "Dia completo": as 34 faixas; as livres criam tarefa naquele horário. */
export function AgendaDayGrid({ tasks, column, onOpenTask, onCreateAt }: AgendaDayGridProps) {
  const byCell = placedTasksByCell(tasks);
  return (
    <ol className="agenda-grid">
      {SLOTS.map((label, slot) => {
        const task = byCell.get(cellKey(column.day, slot));
        return (
          <li key={slot} className={task ? 'agenda-grid__row is-filled' : 'agenda-grid__row'}>
            {task ? (
              <AgendaTaskButton task={task} timeLabel={label} onOpen={onOpenTask} />
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
