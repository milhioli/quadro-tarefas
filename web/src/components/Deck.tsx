import { useDroppable } from '@dnd-kit/core';
import type { Task } from '@quadro/shared';
import { useId } from 'react';
import { DECK_DROP_ID } from '../lib/dnd';
import { TaskCard } from './TaskCard';

export interface DeckProps {
  /** Tarefas do deck, já na ordem do deck. */
  tasks: readonly Task[];
  onOpenTask: (id: number) => void;
}

/** Coluna da esquerda: tarefas fora do quadro. Toda a área aceita soltar. */
export function Deck({ tasks, onOpenTask }: DeckProps) {
  const { setNodeRef, isOver } = useDroppable({ id: DECK_DROP_ID });
  const headingId = useId();

  return (
    <section ref={setNodeRef} className={isOver ? 'deck is-over' : 'deck'} aria-labelledby={headingId}>
      <h2 id={headingId} className="panel-title">{`Tarefas (${tasks.length})`}</h2>
      {tasks.length === 0 ? (
        <p className="deck__empty">
          Nenhuma tarefa no deck. Crie uma em “Nova tarefa” ou arraste uma do quadro para cá.
        </p>
      ) : (
        <ul className="deck__list">
          {tasks.map((task) => (
            <li key={task.id} className="deck__item">
              <TaskCard task={task} onOpen={onOpenTask} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
