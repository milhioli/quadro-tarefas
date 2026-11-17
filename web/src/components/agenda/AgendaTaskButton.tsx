import type { Task } from '@quadro/shared';
import { TaskCardView } from '../TaskCard';

export interface AgendaTaskButtonProps {
  task: Task;
  onOpen: (id: number) => void;
  /** "07:00 – 07:30"; omitido para tarefas sem horário. */
  timeLabel?: string;
}

/** Tarefa na agenda mobile: toque abre a edição (no mobile não há arraste). */
export function AgendaTaskButton({ task, onOpen, timeLabel }: AgendaTaskButtonProps) {
  return (
    <button type="button" className="agenda-task" onClick={() => onOpen(task.id)}>
      {timeLabel ? (
        <>
          <span className="agenda-task__time">{timeLabel}</span>{' '}
        </>
      ) : null}
      <TaskCardView task={task} />
    </button>
  );
}
