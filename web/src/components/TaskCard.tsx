import { useDraggable } from '@dnd-kit/core';
import { checklistProgress, type Task } from '@quadro/shared';
import type { KeyboardEvent } from 'react';
import { taskDragId } from '../lib/dnd';

export interface TaskCardViewProps {
  task: Task;
  compact?: boolean;
  overlay?: boolean;
}

/** Aparência do cartão (sem arraste). Também usado no DragOverlay. */
export function TaskCardView({ task, compact = false, overlay = false }: TaskCardViewProps) {
  const progress = checklistProgress(task.content);
  const classes = ['task-card', `task-card--${task.color}`];
  if (compact) classes.push('task-card--compact');
  if (overlay) classes.push('task-card--overlay');

  // <span> na raiz: o cartão também aparece dentro de <button> (agenda mobile).
  return (
    <span className={classes.join(' ')}>
      {/* Título sempre como texto: nunca interpretado como HTML. */}
      <span className="task-card__title">{task.title}</span>
      {progress.total > 0 ? (
        <span className="task-card__progress">
          <span aria-hidden="true">{`☑ ${progress.done}/${progress.total}`}</span>
          <span className="visually-hidden">{`Checklist: ${progress.done} de ${progress.total} concluídos`}</span>
        </span>
      ) : null}
    </span>
  );
}

export interface TaskCardProps {
  task: Task;
  onOpen: (id: number) => void;
  compact?: boolean;
}

/**
 * Cartão arrastável. Clique, Enter ou Espaço abrem a tarefa. Depois de um
 * arraste o dnd-kit suprime o clique, então soltar não abre o modal.
 */
export function TaskCard({ task, onOpen, compact = false }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: taskDragId(task.id),
    attributes: { roleDescription: 'tarefa arrastável' },
  });

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen(task.id);
    }
  }

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={isDragging ? 'task-card-handle is-dragging' : 'task-card-handle'}
      title={task.title}
      onClick={() => onOpen(task.id)}
      onKeyDown={handleKeyDown}
    >
      <TaskCardView task={task} compact={compact} />
    </div>
  );
}
