import { useDraggable } from '@dnd-kit/core';
import { checklistProgress, type Task } from '@quadro/shared';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { taskDragId } from '../lib/dnd';
import { spanFromPointer } from '../lib/resize';

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

export interface TaskResize {
  /** Até quantos slots a tarefa pode crescer (próxima tarefa do dia ou 22:00). */
  maxSpan: number;
  onResize: (id: number, span: number) => void;
}

export interface TaskCardProps {
  task: Task;
  onOpen: (id: number) => void;
  /** No quadro: cartão menor, com a altura da faixa (`--span` slots). */
  compact?: boolean;
  /** Borda de baixo para mudar a duração. Ausente = sem borda (deck). */
  resize?: TaskResize;
}

interface ResizeGesture {
  startY: number;
  rowHeight: number;
}

/**
 * Cartão arrastável. Clique, Enter ou Espaço abrem a tarefa. Depois de um
 * arraste o dnd-kit suprime o clique, então soltar não abre o modal.
 *
 * A borda de baixo (`resize`) muda a duração com o mouse, fora do dnd-kit:
 * o pointerdown dela não chega ao PointerSensor. Pelo teclado, a duração
 * muda no campo "Até" do modal.
 */
export function TaskCard({ task, onOpen, compact = false, resize }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: taskDragId(task.id),
    attributes: { roleDescription: 'tarefa arrastável' },
  });
  const [preview, setPreview] = useState<number | null>(null);
  const gesture = useRef<ResizeGesture | null>(null);

  // A tarefa mudou (atualização otimista, resposta do servidor ou recarga): sai da prévia.
  useEffect(() => {
    if (!gesture.current) setPreview(null);
  }, [task]);

  const span = preview ?? task.span;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen(task.id);
    }
  }

  function nextSpan(clientY: number, current: ResizeGesture, maxSpan: number): number {
    return spanFromPointer(current.startY, clientY, current.rowHeight, task.span, maxSpan);
  }

  function startResize(event: PointerEvent<HTMLSpanElement>): void {
    if (!resize || event.button !== 0) return;
    // Sem isto o PointerSensor (nos listeners do pai) começaria um arraste.
    event.stopPropagation();
    event.preventDefault();
    const cell = event.currentTarget.closest('td');
    gesture.current = { startY: event.clientY, rowHeight: cell ? cell.getBoundingClientRect().height : 0 };
    try {
      // Continua recebendo o movimento mesmo se o mouse sair da borda.
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Ponteiro sintético (testes) ou já liberado: segue sem captura.
    }
    setPreview(task.span);
  }

  function moveResize(event: PointerEvent<HTMLSpanElement>): void {
    const current = gesture.current;
    if (!resize || !current) return;
    setPreview(nextSpan(event.clientY, current, resize.maxSpan));
  }

  function endResize(event: PointerEvent<HTMLSpanElement>): void {
    const current = gesture.current;
    if (!resize || !current) return;
    event.stopPropagation();
    gesture.current = null;
    const next = nextSpan(event.clientY, current, resize.maxSpan);
    if (next === task.span) {
      setPreview(null);
      return;
    }
    // A prévia fica até a tarefa mudar no cache, para o cartão não piscar no tamanho antigo.
    setPreview(next);
    resize.onResize(task.id, next);
  }

  function cancelResize(): void {
    gesture.current = null;
    setPreview(null);
  }

  const classes = ['task-card-handle'];
  if (isDragging) classes.push('is-dragging');
  if (compact && span > 1) classes.push('task-card-handle--tall');
  if (preview !== null) classes.push('is-resizing');
  const style = compact ? ({ '--span': span } as CSSProperties) : undefined;

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={classes.join(' ')}
      style={style}
      title={task.title}
      onClick={() => onOpen(task.id)}
      onKeyDown={handleKeyDown}
    >
      <TaskCardView task={task} compact={compact} />
      {resize ? (
        <span
          className="task-card__resize"
          aria-hidden="true"
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={cancelResize}
          onClick={(event) => event.stopPropagation()}
        />
      ) : null}
    </div>
  );
}
