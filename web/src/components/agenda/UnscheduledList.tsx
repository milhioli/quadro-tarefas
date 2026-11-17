import type { Task } from '@quadro/shared';
import { useId } from 'react';
import { AgendaTaskButton } from './AgendaTaskButton';

export interface UnscheduledListProps {
  /** Tarefas do deck, já na ordem do deck. */
  tasks: readonly Task[];
  onOpenTask: (id: number) => void;
}

/** O "deck" da agenda mobile: tarefas sem dia e horário. */
export function UnscheduledList({ tasks, onOpenTask }: UnscheduledListProps) {
  const headingId = useId();
  return (
    <section className="agenda-unscheduled" aria-labelledby={headingId}>
      <h2 id={headingId} className="panel-title">{`Sem horário (${tasks.length})`}</h2>
      {tasks.length === 0 ? (
        <p className="agenda-empty">Todas as tarefas têm horário.</p>
      ) : (
        <ul className="agenda-list">
          {tasks.map((task) => (
            <li key={task.id}>
              <AgendaTaskButton task={task} onOpen={onOpenTask} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
