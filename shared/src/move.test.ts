import { describe, expect, it } from 'vitest';
import {
  MoveError,
  applyPositions,
  isPlaced,
  maxSpanAt,
  nextDeckOrder,
  occupantOf,
  occupantsOf,
  planMove,
  planPlacement,
  planReset,
  spanOf,
  type Position,
} from './move';

const deck = (id: number, deckOrder: number): Position => ({ id, day: null, slot: null, deckOrder });
const cell = (id: number, day: number, slot: number): Position => ({ id, day, slot, deckOrder: null });
/** Tarefa com duração: `span` slots a partir de `slot` (no deck quando day/slot são null). */
const block = (id: number, day: number | null, slot: number | null, span: number, deckOrder: number | null = null): Position => ({
  id,
  day,
  slot,
  deckOrder,
  span,
});

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error instanceof MoveError ? error.code : 'outro erro';
  }
};

/** Nenhum slot do quadro é ocupado por duas tarefas. */
function expectNoOverlap(state: readonly Position[]): void {
  const used = new Set<string>();
  for (const p of state.filter(isPlaced)) {
    for (let s = p.slot as number; s < (p.slot as number) + spanOf(p); s++) {
      const key = `${p.day}:${s}`;
      expect(used.has(key), `slot ${key} ocupado duas vezes`).toBe(false);
      used.add(key);
    }
  }
}

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

describe('occupantOf', () => {
  const state = [deck(1, 0), cell(2, 0, 3), cell(3, 4, 33)];

  it('acha quem está na célula', () => {
    expect(occupantOf(state, 0, 3)?.id).toBe(2);
    expect(occupantOf(state, 4, 33)?.id).toBe(3);
    expect(occupantOf(state, 1, 1)).toBeUndefined();
  });

  it('ignora a própria tarefa', () => {
    expect(occupantOf(state, 0, 3, 2)).toBeUndefined();
  });
});

describe('planPlacement', () => {
  const state = [deck(1, 0), deck(2, 1), cell(3, 0, 0)];

  it('agenda em célula livre', () => {
    expect(planPlacement(state, 1, { kind: 'cell', day: 2, slot: 5 })).toEqual([cell(1, 2, 5)]);
  });

  it('recusa célula ocupada por outra tarefa, em vez de trocar', () => {
    expect(codeOf(() => planPlacement(state, 1, { kind: 'cell', day: 0, slot: 0 }))).toBe('OCCUPIED');
    expect(() => planPlacement(state, 1, { kind: 'cell', day: 0, slot: 0 })).toThrow('Esse horário já está ocupado');
  });

  it('a própria célula é no-op', () => {
    expect(planPlacement(state, 3, { kind: 'cell', day: 0, slot: 0 })).toEqual([]);
  });

  it('tirar do quadro manda para o fim do deck; no deck é no-op', () => {
    expect(planPlacement(state, 3, { kind: 'deck' })).toEqual([deck(3, 2)]);
    expect(planPlacement(state, 1, { kind: 'deck' })).toEqual([]);
  });

  it('mover entre células livres', () => {
    expect(planPlacement(state, 3, { kind: 'cell', day: 4, slot: 33 })).toEqual([cell(3, 4, 33)]);
  });

  it('id inexistente e célula fora do quadro', () => {
    expect(codeOf(() => planPlacement(state, 99, { kind: 'cell', day: 1, slot: 1 }))).toBe('NOT_FOUND');
    expect(codeOf(() => planPlacement(state, 1, { kind: 'cell', day: 5, slot: 0 }))).toBe('INVALID_TARGET');
  });
});

describe('tarefas com duração (span)', () => {
  describe('spanOf, occupantsOf e maxSpanAt', () => {
    it('span ausente conta como 1', () => {
      expect(spanOf(cell(1, 0, 0))).toBe(1);
      expect(spanOf(block(1, 0, 0, 4))).toBe(4);
    });

    it('faixas adjacentes não se sobrepõem; parciais sim', () => {
      const state = [block(1, 0, 0, 2), block(2, 0, 2, 2), block(3, 1, 0, 3)];
      expect(occupantsOf(state, 0, 0, 2).map((p) => p.id)).toEqual([1]);
      expect(occupantsOf(state, 0, 1, 2).map((p) => p.id)).toEqual([1, 2]);
      expect(occupantsOf(state, 0, 4, 5)).toEqual([]);
      expect(occupantsOf(state, 1, 2, 1).map((p) => p.id)).toEqual([3]);
      expect(occupantsOf(state, 2, 0, 34)).toEqual([]);
    });

    it('ignora a própria tarefa', () => {
      const state = [block(1, 0, 0, 3)];
      expect(occupantsOf(state, 0, 1, 1, 1)).toEqual([]);
    });

    it('occupantOf acha quem só cobre o slot', () => {
      const state = [block(1, 0, 0, 30)];
      expect(occupantOf(state, 0, 29)?.id).toBe(1);
      expect(occupantOf(state, 0, 30)).toBeUndefined();
    });

    it('maxSpanAt vai até a próxima tarefa ou até 22:00', () => {
      const state = [block(1, 0, 0, 2), block(2, 0, 10, 1)];
      expect(maxSpanAt(state, 0, 2)).toBe(8);
      expect(maxSpanAt(state, 0, 11)).toBe(23);
      expect(maxSpanAt(state, 1, 0)).toBe(34);
      expect(maxSpanAt(state, 1, 33)).toBe(1);
      expect(maxSpanAt(state, 0, 1)).toBe(0);
      expect(maxSpanAt(state, 0, 0, 1)).toBe(10);
      expect(maxSpanAt(state, 5, 0)).toBe(0);
    });
  });

  describe('planMove', () => {
    it('o span vai junto do deck para a célula e de volta', () => {
      const state = [block(1, null, null, 4, 0)];
      const placed = applyPositions(state, planMove(state, 1, { kind: 'cell', day: 2, slot: 10 }));
      expect(placed[0]).toEqual(block(1, 2, 10, 4));
      const back = applyPositions(placed, planMove(placed, 1, { kind: 'deck' }));
      expect(back[0]).toEqual(block(1, null, null, 4, 0));
    });

    it('move para faixa livre, inclusive deslocando dentro da própria faixa', () => {
      const state = [block(1, 0, 0, 30)];
      expect(planMove(state, 1, { kind: 'cell', day: 0, slot: 3 })).toEqual([cell(1, 0, 3)]);
      expect(planMove(state, 1, { kind: 'cell', day: 0, slot: 4 })).toEqual([cell(1, 0, 4)]);
    });

    it('troca exata com uma tarefa do mesmo tamanho, mesmo soltando desalinhado', () => {
      const state = [block(1, 0, 0, 2), block(2, 1, 4, 2)];
      // Solta no segundo slot da outra: a arrastada assume o início dela.
      const changes = planMove(state, 1, { kind: 'cell', day: 1, slot: 5 });
      expect(changes).toEqual([cell(1, 1, 4), cell(2, 0, 0)]);
      const next = applyPositions(state, changes);
      expect(next).toEqual([block(1, 1, 4, 2), block(2, 0, 0, 2)]);
      expectNoOverlap(next);
    });

    it('deck → faixa de mesmo tamanho: a ocupante volta ao deck no lugar da arrastada', () => {
      const state = [block(1, null, null, 3, 7), block(2, 0, 6, 3)];
      expect(planMove(state, 1, { kind: 'cell', day: 0, slot: 7 })).toEqual([cell(1, 0, 6), deck(2, 7)]);
    });

    it('recusa com OCCUPIED quando o tamanho é diferente ou cruza duas tarefas', () => {
      const state = [block(1, 0, 0, 2), block(2, 1, 0, 1), block(3, 2, 0, 2), block(4, 2, 2, 2), block(5, 3, 0, 1)];
      expect(codeOf(() => planMove(state, 1, { kind: 'cell', day: 1, slot: 0 }))).toBe('OCCUPIED');
      expect(codeOf(() => planMove(state, 1, { kind: 'cell', day: 2, slot: 1 }))).toBe('OCCUPIED');
      expect(codeOf(() => planMove(state, 5, { kind: 'cell', day: 0, slot: 1 }))).toBe('OCCUPIED');
      expect(() => planMove(state, 1, { kind: 'cell', day: 1, slot: 0 })).toThrow('Esse horário já está ocupado');
    });

    it('recusa com INVALID_TARGET a faixa que passaria de 22:00', () => {
      const state = [block(1, null, null, 30, 0)];
      expect(codeOf(() => planMove(state, 1, { kind: 'cell', day: 0, slot: 5 }))).toBe('INVALID_TARGET');
      expect(() => planMove(state, 1, { kind: 'cell', day: 0, slot: 5 })).toThrow('A tarefa não cabe até 22:00');
      expect(planMove(state, 1, { kind: 'cell', day: 0, slot: 4 })).toEqual([cell(1, 0, 4)]);
    });

    it('nunca deixa duas tarefas no mesmo slot depois de uma sequência de movimentos', () => {
      let state: Position[] = [block(1, 0, 0, 2), block(2, 0, 2, 2), block(3, null, null, 2, 0), block(4, 1, 0, 5)];
      const moves: Array<[number, Parameters<typeof planMove>[2]]> = [
        [3, { kind: 'cell', day: 0, slot: 3 }],
        [1, { kind: 'cell', day: 0, slot: 2 }],
        [4, { kind: 'cell', day: 0, slot: 20 }],
        [2, { kind: 'deck' }],
        [2, { kind: 'cell', day: 1, slot: 1 }],
      ];
      for (const [id, to] of moves) {
        state = applyPositions(state, planMove(state, id, to));
        expectNoOverlap(state);
      }
      expect(state.map(spanOf)).toEqual([2, 2, 2, 5]);
    });
  });

  describe('planPlacement', () => {
    it('recusa qualquer sobreposição, mesmo com o mesmo tamanho', () => {
      const state = [block(1, null, null, 2, 0), block(2, 0, 4, 2)];
      expect(codeOf(() => planPlacement(state, 1, { kind: 'cell', day: 0, slot: 4 }))).toBe('OCCUPIED');
      expect(codeOf(() => planPlacement(state, 1, { kind: 'cell', day: 0, slot: 3 }))).toBe('OCCUPIED');
      expect(planPlacement(state, 1, { kind: 'cell', day: 0, slot: 2 })).toEqual([cell(1, 0, 2)]);
    });

    it('valida um span que cresceu na própria célula (redimensionar)', () => {
      // A tarefa 1 já está com o span novo (4) no estado; a 2 começa logo depois do span antigo.
      const grown = [block(1, 0, 0, 4), block(2, 0, 2, 1)];
      expect(codeOf(() => planPlacement(grown, 1, { kind: 'cell', day: 0, slot: 0 }))).toBe('OCCUPIED');
      const fits = [block(1, 0, 0, 2), block(2, 0, 2, 1)];
      expect(planPlacement(fits, 1, { kind: 'cell', day: 0, slot: 0 })).toEqual([]);
    });

    it('a própria célula estourando 22:00 dá INVALID_TARGET', () => {
      const state = [block(1, 0, 32, 3)];
      expect(codeOf(() => planPlacement(state, 1, { kind: 'cell', day: 0, slot: 32 }))).toBe('INVALID_TARGET');
    });
  });

  it('planReset e applyPositions preservam o span', () => {
    const items = [
      { ...block(1, 0, 0, 3), title: 'A' },
      { ...block(2, 1, 5, 2), title: 'B' },
    ];
    const next = applyPositions(items, planReset(items));
    expect(next.map((t) => [t.title, t.span, t.day])).toEqual([
      ['A', 3, null],
      ['B', 2, null],
    ]);
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
