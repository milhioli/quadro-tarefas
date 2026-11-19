import type { BoardSummary } from '@quadro/shared';

/**
 * Só o id do último quadro aberto fica no localStorage, e só vale se estiver
 * entre os quadros da pessoa. A origem 127.0.0.1:5173 é compartilhada com
 * outros projetos Vite: nada de tarefas, nomes ou dados da conta aqui.
 */
export const BOARD_STORAGE_KEY = 'quadro:board';

const BOARD_ID = /^[1-9]\d{0,14}$/;

export type BoardStorage = () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** O próprio acesso a window.localStorage pode lançar (SecurityError), por isso é uma função. */
export const browserBoardStorage: BoardStorage = () => window.localStorage;

export function parseBoardChoice(value: unknown): number | null {
  return typeof value === 'string' && BOARD_ID.test(value) ? Number(value) : null;
}

export function loadBoardChoice(getStorage: BoardStorage): number | null {
  try {
    return parseBoardChoice(getStorage().getItem(BOARD_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function saveBoardChoice(getStorage: BoardStorage, boardId: number): void {
  try {
    getStorage().setItem(BOARD_STORAGE_KEY, String(boardId));
  } catch {
    // Sem storage (modo privado, bloqueio): o quadro só não fica lembrado.
  }
}

export function clearBoardChoice(getStorage: BoardStorage): void {
  try {
    getStorage().removeItem(BOARD_STORAGE_KEY);
  } catch {
    // Idem.
  }
}

/** O quadro a abrir: o escolhido, se a pessoa ainda o vê; senão o pessoal; senão o primeiro. */
export function pickBoard(boards: readonly BoardSummary[], chosen: number | null, personalBoardId: number): number {
  if (chosen !== null && boards.some((b) => b.id === chosen)) return chosen;
  if (boards.some((b) => b.id === personalBoardId)) return personalBoardId;
  return boards[0]?.id ?? personalBoardId;
}
