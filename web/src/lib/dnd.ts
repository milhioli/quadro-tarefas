import type { Modifier, UniqueIdentifier } from '@dnd-kit/core';
import { getEventCoordinates } from '@dnd-kit/utilities';
import {
  MoveError,
  dayName,
  isValidDay,
  isValidSlot,
  planMove,
  slotLabel,
  type MoveTarget,
  type Position,
} from '@quadro/shared';

/**
 * Identificadores do drag and drop. A lógica de "para onde a tarefa vai"
 * fica aqui, em funções puras, porque o arraste real não é simulável no jsdom.
 */
export const DECK_DROP_ID = 'deck';

/** O arraste só começa depois de 5 px; abaixo disso é clique (abre o modal). */
export const POINTER_ACTIVATION = Object.freeze({ distance: 5 });

export function taskDragId(id: number): string {
  return `task:${id}`;
}

export function parseTaskDragId(id: UniqueIdentifier | null | undefined): number | null {
  if (typeof id !== 'string') return null;
  const match = /^task:([1-9]\d{0,14})$/.exec(id);
  return match ? Number(match[1]) : null;
}

export function cellDropId(day: number, slot: number): string {
  return `cell:${day}:${slot}`;
}

export function parseDropId(id: UniqueIdentifier | null | undefined): MoveTarget | null {
  if (id === DECK_DROP_ID) return { kind: 'deck' };
  if (typeof id !== 'string') return null;
  const match = /^cell:(\d{1,2}):(\d{1,2})$/.exec(id);
  if (!match) return null;
  const day = Number(match[1]);
  const slot = Number(match[2]);
  return isValidDay(day) && isValidSlot(slot) ? { kind: 'cell', day, slot } : null;
}

export interface DropIntent {
  taskId: number;
  to: MoveTarget;
}

/**
 * Converte o fim de um arraste num movimento. Devolve null quando não há
 * nada a fazer: alvo desconhecido, tarefa inexistente ou soltar no mesmo lugar.
 * Um horário ocupado (ou que não cabe até 22:00) ainda vira movimento: quem
 * decide é o servidor, que responde 409/400, e o App mostra o aviso.
 */
export function dropToMove(
  state: readonly Position[],
  activeId: UniqueIdentifier | null | undefined,
  overId: UniqueIdentifier | null | undefined,
): DropIntent | null {
  const taskId = parseTaskDragId(activeId);
  const to = parseDropId(overId);
  if (taskId === null || to === null) return null;
  try {
    return planMove(state, taskId, to).length > 0 ? { taskId, to } : null;
  } catch (error) {
    return error instanceof MoveError && error.code !== 'NOT_FOUND' ? { taskId, to } : null;
  }
}

/**
 * Modificador do DragOverlay. O overlay nasce no canto de cima do cartão de
 * origem; num cartão alto pego pela parte de baixo, ele ficaria muito acima
 * do ponteiro. Aqui ele desce até o ponteiro ficar no meio dele.
 */
export const keepOverlayUnderPointer: Modifier = ({ activatorEvent, activeNodeRect, overlayNodeRect, transform }) => {
  if (!activatorEvent || !activeNodeRect || !overlayNodeRect) return transform;
  const pointer = getEventCoordinates(activatorEvent);
  if (!pointer) return transform;
  const shift = pointer.y - activeNodeRect.top - overlayNodeRect.height / 2;
  return shift > 0 ? { ...transform, y: transform.y + shift } : transform;
};

/** Texto em pt-BR do alvo, para os anúncios de leitor de tela. */
export function describeDropTarget(id: UniqueIdentifier | null | undefined): string {
  const target = parseDropId(id);
  if (!target) return 'uma área inválida';
  if (target.kind === 'deck') return 'o deck de tarefas';
  return `${dayName(target.day)}, ${slotLabel(target.slot)}`;
}
