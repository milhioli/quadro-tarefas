import { useDroppable } from '@dnd-kit/core';
import type { Task } from '@quadro/shared';
import { cellDropId } from '../lib/dnd';
import { TaskCard } from './TaskCard';

export interface BoardCellProps {
  day: number;
  slot: number;
  /** "Segunda 09/11, 05:00 – 05:30". */
  label: string;
  task: Task | undefined;
  isToday: boolean;
  onOpenTask: (id: number) => void;
}

/** Célula do quadro: aceita soltar e mostra no máximo uma tarefa. */
export function BoardCell({ day, slot, label, task, isToday, onOpenTask }: BoardCellProps) {
  const { setNodeRef, isOver } = useDroppable({ id: cellDropId(day, slot) });
  const classes = ['board-cell'];
  if (isToday) classes.push('is-today');
  if (isOver) classes.push('is-over');
  if (task) classes.push('is-filled');

  return (
    <td ref={setNodeRef} className={classes.join(' ')} aria-label={label}>
      {task ? <TaskCard task={task} onOpen={onOpenTask} compact /> : null}
    </td>
  );
}
