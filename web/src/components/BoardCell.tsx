import { useDroppable } from '@dnd-kit/core';
import type { BoardStart } from '../lib/board';
import { cellDropId } from '../lib/dnd';
import { TaskCard } from './TaskCard';

export interface BoardCellProps {
  day: number;
  slot: number;
  /** "Segunda 09/11, 05:00 – 05:30". */
  label: string;
  /** Tarefa que começa nesta célula: o cartão é desenhado aqui, com a altura da faixa. */
  start?: BoardStart;
  /** Continuação da faixa de uma tarefa que começou acima (fica vazia, sob o cartão). */
  covered?: boolean;
  isToday: boolean;
  onOpenTask: (id: number) => void;
  /** Redimensionar pela borda de baixo. Ausente = cartão sem borda. */
  onResizeTask?: (id: number, span: number) => void;
}

/**
 * Célula do quadro: aceita soltar (também quando coberta, para o arraste
 * mirar o ponteiro) e desenha a tarefa que começa nela.
 */
export function BoardCell({ day, slot, label, start, covered = false, isToday, onOpenTask, onResizeTask }: BoardCellProps) {
  const { setNodeRef, isOver } = useDroppable({ id: cellDropId(day, slot) });
  const classes = ['board-cell'];
  if (isToday) classes.push('is-today');
  if (isOver) classes.push('is-over');
  if (start) classes.push('is-filled');
  if (covered) classes.push('is-covered');

  return (
    <td ref={setNodeRef} className={classes.join(' ')} aria-label={label}>
      {start ? (
        <TaskCard
          task={start.task}
          onOpen={onOpenTask}
          compact
          resize={onResizeTask ? { maxSpan: start.maxSpan, onResize: onResizeTask } : undefined}
        />
      ) : null}
    </td>
  );
}
