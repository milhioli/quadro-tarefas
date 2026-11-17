import { slotLabel, type Task } from '@quadro/shared';
import { tasksForDay } from '../../lib/agenda';
import { AgendaTaskButton } from './AgendaTaskButton';

export interface AgendaDayListProps {
  tasks: readonly Task[];
  day: number;
  onOpenTask: (id: number) => void;
}

/** Visualização "Dia": só os horários ocupados, em ordem. */
export function AgendaDayList({ tasks, day, onOpenTask }: AgendaDayListProps) {
  const items = tasksForDay(tasks, day);
  if (items.length === 0) return <p className="agenda-empty">Nada agendado neste dia.</p>;
  return (
    <ul className="agenda-list">
      {items.map((task) => (
        <li key={task.id}>
          <AgendaTaskButton task={task} timeLabel={slotLabel(task.slot as number)} onOpen={onOpenTask} />
        </li>
      ))}
    </ul>
  );
}
