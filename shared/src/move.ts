import { isValidDay } from './days';
import type { MoveTarget } from './schemas';
import { isValidSlot } from './slots';

/**
 * Posição de uma tarefa. Invariante: ou está no deck (deckOrder != null e
 * day/slot null), ou está em exatamente uma célula (day/slot != null e
 * deckOrder null).
 */
export interface Position {
  id: number;
  day: number | null;
  slot: number | null;
  deckOrder: number | null;
}

export type MoveErrorCode = 'NOT_FOUND' | 'INVALID_TARGET' | 'OCCUPIED';

export class MoveError extends Error {
  readonly code: MoveErrorCode;

  constructor(code: MoveErrorCode, message: string) {
    super(message);
    this.name = 'MoveError';
    this.code = code;
  }
}

export function isPlaced(position: Position): boolean {
  return position.day !== null && position.slot !== null;
}

/** Próxima posição livre no fim do deck. */
export function nextDeckOrder(state: readonly Position[]): number {
  let max = -1;
  for (const p of state) {
    if (!isPlaced(p) && p.deckOrder !== null && p.deckOrder > max) max = p.deckOrder;
  }
  return max + 1;
}

/**
 * Calcula as mudanças de posição para mover `taskId` até `to`.
 * Regra: uma tarefa por célula; soltar numa célula ocupada troca as tarefas.
 * Devolve apenas as linhas alteradas ([] = nada a fazer).
 */
export function planMove(state: readonly Position[], taskId: number, to: MoveTarget): Position[] {
  const task = state.find((p) => p.id === taskId);
  if (!task) throw new MoveError('NOT_FOUND', 'Tarefa não encontrada');

  if (to.kind === 'deck') {
    if (!isPlaced(task)) return [];
    return [{ id: task.id, day: null, slot: null, deckOrder: nextDeckOrder(state) }];
  }

  if (!isValidDay(to.day) || !isValidSlot(to.slot)) {
    throw new MoveError('INVALID_TARGET', 'Célula inválida');
  }
  if (task.day === to.day && task.slot === to.slot) return [];

  const changes: Position[] = [{ id: task.id, day: to.day, slot: to.slot, deckOrder: null }];
  const occupant = state.find((p) => p.id !== task.id && p.day === to.day && p.slot === to.slot);
  if (occupant) {
    if (isPlaced(task)) {
      // Célula → célula ocupada: o ocupante vai para a célula de origem.
      changes.push({ id: occupant.id, day: task.day, slot: task.slot, deckOrder: null });
    } else {
      // Deck → célula ocupada: o ocupante volta ao deck no lugar da tarefa arrastada.
      changes.push({
        id: occupant.id,
        day: null,
        slot: null,
        deckOrder: task.deckOrder ?? nextDeckOrder(state),
      });
    }
  }
  return changes;
}

/** Tarefa que ocupa a célula, ignorando `exceptId` (a própria tarefa). */
export function occupantOf<T extends Position>(
  state: readonly T[],
  day: number,
  slot: number,
  exceptId?: number,
): T | undefined {
  return state.find((p) => p.id !== exceptId && p.day === day && p.slot === slot);
}

/**
 * Como `planMove`, mas para agendar pelo formulário: uma célula ocupada por
 * outra tarefa é recusada (MoveError 'OCCUPIED') em vez de trocar.
 */
export function planPlacement(state: readonly Position[], taskId: number, to: MoveTarget): Position[] {
  if (!state.some((p) => p.id === taskId)) throw new MoveError('NOT_FOUND', 'Tarefa não encontrada');
  if (to.kind === 'cell' && isValidDay(to.day) && isValidSlot(to.slot) && occupantOf(state, to.day, to.slot, taskId)) {
    throw new MoveError('OCCUPIED', 'Esse horário já está ocupado');
  }
  return planMove(state, taskId, to);
}

/** Devolve todas as tarefas do quadro ao fim do deck, na ordem (dia, horário). */
export function planReset(state: readonly Position[]): Position[] {
  const placed = state
    .filter(isPlaced)
    .sort((a, b) => (a.day as number) - (b.day as number) || (a.slot as number) - (b.slot as number) || a.id - b.id);
  let order = nextDeckOrder(state);
  return placed.map((p) => ({ id: p.id, day: null, slot: null, deckOrder: order++ }));
}

/** Aplica as mudanças sobre a lista, preservando os demais campos. */
export function applyPositions<T extends Position>(items: readonly T[], changes: readonly Position[]): T[] {
  if (changes.length === 0) return [...items];
  const byId = new Map(changes.map((c) => [c.id, c]));
  return items.map((item) => {
    const change = byId.get(item.id);
    return change ? { ...item, day: change.day, slot: change.slot, deckOrder: change.deckOrder } : item;
  });
}
