import type { Position } from '@quadro/shared';
import { describe, expect, it } from 'vitest';
import {
  DECK_DROP_ID,
  POINTER_ACTIVATION,
  cellDropId,
  describeDropTarget,
  dropToMove,
  parseDropId,
  parseTaskDragId,
  taskDragId,
} from './dnd';

const deck = (id: number, deckOrder: number): Position => ({ id, day: null, slot: null, deckOrder });
const cell = (id: number, day: number, slot: number): Position => ({ id, day, slot, deckOrder: null });

describe('POINTER_ACTIVATION', () => {
  it('exige 5 px para distinguir clique de arraste', () => {
    expect(POINTER_ACTIVATION).toEqual({ distance: 5 });
  });
});

describe('ids de arraste', () => {
  it('taskDragId e parseTaskDragId fazem ida e volta', () => {
    expect(taskDragId(42)).toBe('task:42');
    expect(parseTaskDragId('task:42')).toBe(42);
  });

  it('parseTaskDragId rejeita o que não é tarefa', () => {
    for (const id of ['task:0', 'task:-1', 'task:1.5', 'task:01', 'cell:0:0', 'deck', 42, null, undefined]) {
      expect(parseTaskDragId(id)).toBeNull();
    }
  });
});

describe('ids de destino', () => {
  it('deck e células', () => {
    expect(parseDropId(DECK_DROP_ID)).toEqual({ kind: 'deck' });
    expect(cellDropId(4, 33)).toBe('cell:4:33');
    expect(parseDropId(cellDropId(4, 33))).toEqual({ kind: 'cell', day: 4, slot: 33 });
    expect(parseDropId('cell:0:0')).toEqual({ kind: 'cell', day: 0, slot: 0 });
  });

  it('rejeita células fora do quadro e ids desconhecidos', () => {
    for (const id of ['cell:5:0', 'cell:0:34', 'cell:-1:0', 'cell:a:b', 'cell:0', 'task:1', '', 7, null, undefined]) {
      expect(parseDropId(id)).toBeNull();
    }
  });
});

describe('dropToMove', () => {
  const state = [deck(1, 0), deck(2, 1), cell(3, 0, 0), cell(4, 2, 10)];

  it('deck → célula vazia', () => {
    expect(dropToMove(state, 'task:1', 'cell:1:5')).toEqual({ taskId: 1, to: { kind: 'cell', day: 1, slot: 5 } });
  });

  it('célula → célula ocupada (troca)', () => {
    expect(dropToMove(state, 'task:3', 'cell:2:10')).toEqual({ taskId: 3, to: { kind: 'cell', day: 2, slot: 10 } });
  });

  it('célula → deck', () => {
    expect(dropToMove(state, 'task:4', 'deck')).toEqual({ taskId: 4, to: { kind: 'deck' } });
  });

  it('soltar no mesmo lugar não faz nada', () => {
    expect(dropToMove(state, 'task:3', 'cell:0:0')).toBeNull();
    expect(dropToMove(state, 'task:1', 'deck')).toBeNull();
  });

  it('sem destino, destino inválido ou tarefa inexistente → null', () => {
    expect(dropToMove(state, 'task:1', null)).toBeNull();
    expect(dropToMove(state, 'task:1', 'cell:9:9')).toBeNull();
    expect(dropToMove(state, 'task:99', 'cell:1:1')).toBeNull();
    expect(dropToMove(state, 'coisa', 'cell:1:1')).toBeNull();
  });
});

describe('describeDropTarget', () => {
  it('descreve deck, células e alvos inválidos em pt-BR', () => {
    expect(describeDropTarget('deck')).toBe('o deck de tarefas');
    expect(describeDropTarget('cell:0:0')).toBe('Segunda, 05:00 – 05:30');
    expect(describeDropTarget('cell:4:33')).toBe('Sexta, 21:30 – 22:00');
    expect(describeDropTarget('x')).toBe('uma área inválida');
  });
});
