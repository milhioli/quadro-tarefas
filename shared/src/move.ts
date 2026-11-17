import { isValidDay } from './days';
import type { MoveTarget } from './schemas';
import { SLOT_COUNT, isValidSlot } from './slots';

/**
 * Posição de uma tarefa. Invariante: ou está no deck (deckOrder != null e
 * day/slot null), ou começa em exatamente uma célula (day/slot != null e
 * deckOrder null) e ocupa `span` slots seguidos daquele dia.
 */
export interface Position {
  id: number;
  day: number | null;
  /** Primeiro slot ocupado. */
  slot: number | null;
  deckOrder: number | null;
  /**
   * Quantos slots seguidos a tarefa ocupa (ausente = 1). É da tarefa: vai
   * junto no arraste e no deck, e nenhuma função de movimento o altera.
   */
  span?: number;
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

export const OCCUPIED_MESSAGE = 'Esse horário já está ocupado';
export const DOES_NOT_FIT_MESSAGE = 'A tarefa não cabe até 22:00';

export function isPlaced(position: Position): boolean {
  return position.day !== null && position.slot !== null;
}

export function spanOf(position: Position): number {
  return position.span ?? 1;
}

/** As faixas [a, a + spanA) e [b, b + spanB) se cruzam. */
function overlaps(a: number, spanA: number, b: number, spanB: number): boolean {
  return a < b + spanB && b < a + spanA;
}

/** Próxima posição livre no fim do deck. */
export function nextDeckOrder(state: readonly Position[]): number {
  let max = -1;
  for (const p of state) {
    if (!isPlaced(p) && p.deckOrder !== null && p.deckOrder > max) max = p.deckOrder;
  }
  return max + 1;
}

/** Tarefas do dia cuja faixa cruza [slot, slot + span), em ordem de horário, ignorando `exceptId`. */
export function occupantsOf<T extends Position>(
  state: readonly T[],
  day: number,
  slot: number,
  span: number,
  exceptId?: number,
): T[] {
  return state
    .filter((p) => p.id !== exceptId && p.day === day && p.slot !== null && overlaps(p.slot, spanOf(p), slot, span))
    .sort((a, b) => (a.slot as number) - (b.slot as number) || a.id - b.id);
}

/** Tarefa que ocupa a célula (inclusive uma que só a cobre), ignorando `exceptId`. */
export function occupantOf<T extends Position>(
  state: readonly T[],
  day: number,
  slot: number,
  exceptId?: number,
): T | undefined {
  return occupantsOf(state, day, slot, 1, exceptId)[0];
}

/**
 * Quantos slots cabem a partir de (day, slot): até a próxima tarefa abaixo
 * ou até 22:00. É 0 quando o próprio slot já está ocupado. Ignora `exceptId`.
 */
export function maxSpanAt(state: readonly Position[], day: number, slot: number, exceptId?: number): number {
  if (!isValidDay(day) || !isValidSlot(slot)) return 0;
  let limit = SLOT_COUNT - slot;
  for (const p of state) {
    if (p.id === exceptId || p.day !== day || p.slot === null) continue;
    if (overlaps(p.slot, spanOf(p), slot, 1)) return 0;
    if (p.slot > slot) limit = Math.min(limit, p.slot - slot);
  }
  return limit;
}

/**
 * Calcula as mudanças de posição para mover `taskId` até `to` (o arraste).
 * - Faixa livre: move.
 * - A faixa cruza exatamente uma tarefa do mesmo tamanho: as duas trocam, e a
 *   arrastada assume o início da outra (troca exata, mesmo soltando desalinhado).
 * - Qualquer outra sobreposição: MoveError('OCCUPIED'). Nada é empurrado.
 * - Não cabe até 22:00: MoveError('INVALID_TARGET').
 * Devolve apenas as linhas alteradas ([] = nada a fazer), sem o `span`.
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
  const span = spanOf(task);
  if (to.slot + span > SLOT_COUNT) throw new MoveError('INVALID_TARGET', DOES_NOT_FIT_MESSAGE);
  if (task.day === to.day && task.slot === to.slot) return [];

  const hits = occupantsOf(state, to.day, to.slot, span, task.id);
  if (hits.length === 0) return [{ id: task.id, day: to.day, slot: to.slot, deckOrder: null }];

  const occupant = hits[0];
  if (hits.length > 1 || !occupant || spanOf(occupant) !== span) {
    throw new MoveError('OCCUPIED', OCCUPIED_MESSAGE);
  }
  const changes: Position[] = [{ id: task.id, day: occupant.day, slot: occupant.slot, deckOrder: null }];
  if (isPlaced(task)) {
    // Célula → célula ocupada: o ocupante vai para a origem da arrastada.
    changes.push({ id: occupant.id, day: task.day, slot: task.slot, deckOrder: null });
  } else {
    // Deck → célula ocupada: o ocupante volta ao deck no lugar da tarefa arrastada.
    changes.push({ id: occupant.id, day: null, slot: null, deckOrder: task.deckOrder ?? nextDeckOrder(state) });
  }
  return changes;
}

/**
 * Como `planMove`, mas para agendar pelo formulário ou mudar a duração: a
 * faixa não pode cruzar nenhuma outra tarefa (MoveError 'OCCUPIED', sem troca)
 * nem passar de 22:00 (MoveError 'INVALID_TARGET'). A checagem vale também
 * para a própria célula, que é como se valida um `span` que cresceu no lugar.
 */
export function planPlacement(state: readonly Position[], taskId: number, to: MoveTarget): Position[] {
  const task = state.find((p) => p.id === taskId);
  if (!task) throw new MoveError('NOT_FOUND', 'Tarefa não encontrada');
  if (to.kind === 'cell' && isValidDay(to.day) && isValidSlot(to.slot)) {
    const span = spanOf(task);
    if (to.slot + span > SLOT_COUNT) throw new MoveError('INVALID_TARGET', DOES_NOT_FIT_MESSAGE);
    if (occupantsOf(state, to.day, to.slot, span, taskId).length > 0) {
      throw new MoveError('OCCUPIED', OCCUPIED_MESSAGE);
    }
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

/** Aplica as mudanças sobre a lista, preservando os demais campos (inclusive o `span`). */
export function applyPositions<T extends Position>(items: readonly T[], changes: readonly Position[]): T[] {
  if (changes.length === 0) return [...items];
  const byId = new Map(changes.map((c) => [c.id, c]));
  return items.map((item) => {
    const change = byId.get(item.id);
    return change ? { ...item, day: change.day, slot: change.slot, deckOrder: change.deckOrder } : item;
  });
}
