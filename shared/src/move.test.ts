import { describe, expect, it } from 'vitest';
import { MoveError, applyPositions, isPlaced, nextDeckOrder, planMove, planReset, type Position } from './move';

const deck = (id: number, deckOrder: number): Position => ({ id, day: null, slot: null, deckOrder });
const cell = (id: number, day: number, slot: number): Position => ({ id, day, slot, deckOrder: null });

describe('nextDeckOrder', () => {
  it('é 0 com deck vazio e max+1 caso contrário', () => {
    expect(nextDeckOrder([])).toBe(0);
    expect(nextDeckOrder([cell(1, 0, 0)])).toBe(0);
    expect(nextDeckOrder([deck(1, 3), deck(2, 7), cell(3, 0, 0)])).toBe(8);
  });
});

describe('planMove', () => {
  it('deck → célula vazia', () => {
    const state = [deck(1, 0), deck(2, 1)];
    expect(planMove(state, 1, { kind: 'cell', day: 2, slot: 5 })).toEqual([cell(1, 2, 5)]);
  });

  it('deck → célula ocupada: o ocupante volta ao deck no lugar da tarefa arrastada', () => {
    const state = [deck(1, 4), cell(2, 0, 0)];
    expect(planMove(state, 1, { kind: 'cell', day: 0, slot: 0 })).toEqual([cell(1, 0, 0), deck(2, 4)]);
  });

  it('célula → célula vazia', () => {
    const state = [cell(1, 0, 0)];
    expect(planMove(state, 1, { kind: 'cell', day: 4, slot: 33 })).toEqual([cell(1, 4, 33)]);
  });

  it('célula → célula ocupada: as tarefas trocam de lugar', () => {
    const state = [cell(1, 0, 0), cell(2, 3, 10)];
    expect(planMove(state, 1, { kind: 'cell', day: 3, slot: 10 })).toEqual([cell(1, 3, 10), cell(2, 0, 0)]);
  });

  it('célula → deck: vai para o fim do deck', () => {
    const state = [deck(1, 0), deck(2, 5), cell(3, 1, 1)];
    expect(planMove(state, 3, { kind: 'deck' })).toEqual([deck(3, 6)]);
  });

  it('sem mudança quando solta no mesmo lugar ou deck → deck', () => {
    expect(planMove([cell(1, 1, 1)], 1, { kind: 'cell', day: 1, slot: 1 })).toEqual([]);
    expect(planMove([deck(1, 0)], 1, { kind: 'deck' })).toEqual([]);
  });

  it('lança NOT_FOUND para id inexistente', () => {
    try {
      planMove([deck(1, 0)], 99, { kind: 'deck' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MoveError);
      expect((error as MoveError).code).toBe('NOT_FOUND');
    }
  });

  it('lança INVALID_TARGET para célula fora do quadro', () => {
    expect(() => planMove([deck(1, 0)], 1, { kind: 'cell', day: 5, slot: 0 })).toThrow(MoveError);
    expect(() => planMove([deck(1, 0)], 1, { kind: 'cell', day: 0, slot: 34 })).toThrow(/Célula inválida/);
  });

  it('nunca deixa duas tarefas na mesma célula', () => {
    const state = [deck(1, 0), cell(2, 0, 0), cell(3, 0, 1)];
    const next = applyPositions(state, planMove(state, 3, { kind: 'cell', day: 0, slot: 0 }));
    const keys = next.filter(isPlaced).map((p) => `${p.day}:${p.slot}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(next).toHaveLength(3);
  });
});

describe('planReset', () => {
  it('devolve as tarefas do quadro ao fim do deck ordenadas por dia e horário', () => {
    const state = [deck(1, 0), cell(2, 3, 0), cell(3, 0, 20), cell(4, 0, 2), deck(5, 1)];
    expect(planReset(state)).toEqual([deck(4, 2), deck(3, 3), deck(2, 4)]);
  });

  it('não muda nada quando o quadro está vazio', () => {
    expect(planReset([deck(1, 0)])).toEqual([]);
  });
});

describe('applyPositions', () => {
  it('altera só as posições e preserva os demais campos', () => {
    const items = [
      { ...deck(1, 0), title: 'A' },
      { ...cell(2, 0, 0), title: 'B' },
    ];
    const next = applyPositions(items, [cell(1, 0, 0), deck(2, 0)]);
    expect(next).toEqual([
      { ...cell(1, 0, 0), title: 'A' },
      { ...deck(2, 0), title: 'B' },
    ]);
    expect(items[0]?.day).toBeNull();
  });

  it('devolve uma cópia quando não há mudanças', () => {
    const items = [deck(1, 0)];
    const next = applyPositions(items, []);
    expect(next).toEqual(items);
    expect(next).not.toBe(items);
  });
});
