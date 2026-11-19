import type { BoardSummary } from '@quadro/shared';
import { describe, expect, it } from 'vitest';
import {
  BOARD_STORAGE_KEY,
  browserBoardStorage,
  clearBoardChoice,
  loadBoardChoice,
  parseBoardChoice,
  pickBoard,
  saveBoardChoice,
  type BoardStorage,
} from './boardChoice';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data,
  };
}

const BOARDS: BoardSummary[] = [
  { id: 2, name: 'Meu quadro', kind: 'personal', role: 'owner' },
  { id: 9, name: 'Equipe', kind: 'group', role: 'editor' },
];

describe('parseBoardChoice', () => {
  it('aceita só um id inteiro positivo em decimal', () => {
    expect(parseBoardChoice('9')).toBe(9);
    for (const value of [null, undefined, '', '0', '-1', '1.5', '09', 'abc', '__proto__', '1e3', ' 9', 9]) {
      expect(parseBoardChoice(value), String(value)).toBeNull();
    }
  });
});

describe('load, save e clear', () => {
  it('guarda só o id, na chave quadro:board', () => {
    const storage = memoryStorage();
    const get: BoardStorage = () => storage;
    saveBoardChoice(get, 9);
    expect([...storage.data]).toEqual([[BOARD_STORAGE_KEY, '9']]);
    expect(loadBoardChoice(get)).toBe(9);
    clearBoardChoice(get);
    expect(loadBoardChoice(get)).toBeNull();
  });

  it('valor estranho salvo por outro projeto vira null', () => {
    expect(loadBoardChoice(() => memoryStorage({ [BOARD_STORAGE_KEY]: '{"id":9}' }))).toBeNull();
  });

  it('storage que lança não derruba nada', () => {
    const denied: BoardStorage = () => {
      throw new DOMException('negado', 'SecurityError');
    };
    expect(loadBoardChoice(denied)).toBeNull();
    expect(() => saveBoardChoice(denied, 9)).not.toThrow();
    expect(() => clearBoardChoice(denied)).not.toThrow();
  });

  it('browserBoardStorage usa o localStorage do navegador', () => {
    saveBoardChoice(browserBoardStorage, 4);
    expect(window.localStorage.getItem(BOARD_STORAGE_KEY)).toBe('4');
  });
});

describe('pickBoard', () => {
  it('usa o escolhido se a pessoa ainda o vê', () => {
    expect(pickBoard(BOARDS, 9, 2)).toBe(9);
  });

  it('quadro que a pessoa não vê mais (saiu, foi removida, outra conta) cai no pessoal', () => {
    expect(pickBoard(BOARDS, 77, 2)).toBe(2);
    expect(pickBoard(BOARDS, null, 2)).toBe(2);
  });

  it('sem o pessoal na lista, o primeiro; lista vazia, o pessoal', () => {
    expect(pickBoard([BOARDS[1] as BoardSummary], null, 2)).toBe(9);
    expect(pickBoard([], null, 2)).toBe(2);
  });
});
