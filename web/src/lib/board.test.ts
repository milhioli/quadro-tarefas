import { describe, expect, it } from 'vitest';
import { makeTask } from '../test/fakeApi';
import { isoDate, parseIsoDate } from './calendar';
import { boardColumns, boardLayout, cellKey, deckTasks, isOnBoard } from './board';

const d = (iso: string) => parseIsoDate(iso) as Date;

describe('boardColumns', () => {
  it('segunda a sexta da semana de hoje, marcando hoje', () => {
    const columns = boardColumns(d('2026-11-13'));
    expect(columns.map((c) => c.label)).toEqual(['Seg 09/11', 'Ter 10/11', 'Qua 11/11', 'Qui 12/11', 'Sex 13/11']);
    expect(columns.map((c) => c.day)).toEqual([0, 1, 2, 3, 4]);
    expect(columns.map((c) => c.isToday)).toEqual([false, false, false, false, true]);
  });

  it('no domingo mostra a semana seguinte, sem dia marcado como hoje', () => {
    const columns = boardColumns(d('2026-11-15'));
    expect(columns.map((c) => isoDate(c.date))).toEqual([
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
    ]);
    expect(columns.some((c) => c.isToday)).toBe(false);
    expect(columns[4]?.holidays.map((h) => h.name)).toEqual(['Dia Nacional de Zumbi e da Consciência Negra']);
  });

  it('traz os feriados de cada coluna', () => {
    const columns = boardColumns(d('2026-02-16'));
    expect(columns[0]?.holidays).toEqual([expect.objectContaining({ name: 'Carnaval', kind: 'facultativo' })]);
    expect(columns[1]?.holidays).toEqual([expect.objectContaining({ name: 'Carnaval', kind: 'facultativo' })]);
    expect(columns[2]?.holidays).toEqual([]);
  });
});

describe('deck e quadro', () => {
  const tasks = [
    makeTask({ id: 1, deckOrder: 5 }),
    makeTask({ id: 2, day: 0, slot: 3 }),
    makeTask({ id: 3, deckOrder: 1 }),
    makeTask({ id: 4, day: 4, slot: 33 }),
    makeTask({ id: 5, deckOrder: 1 }),
  ];

  it('cellKey', () => {
    expect(cellKey(4, 33)).toBe('4:33');
  });

  it('isOnBoard', () => {
    expect(isOnBoard(makeTask({ id: 9 }))).toBe(false);
    expect(isOnBoard(makeTask({ id: 9, day: 1, slot: 2 }))).toBe(true);
  });

  it('deckTasks ordena por deckOrder e depois id', () => {
    expect(deckTasks(tasks).map((t) => t.id)).toEqual([3, 5, 1]);
  });

  it('boardLayout indexa onde cada tarefa do quadro começa', () => {
    const { starts, covered } = boardLayout(tasks);
    expect(starts.size).toBe(2);
    expect(starts.get('0:3')?.task.id).toBe(2);
    expect(starts.get('4:33')?.task.id).toBe(4);
    expect(starts.get('1:1')).toBeUndefined();
    expect(covered.size).toBe(0);
  });

  it('boardLayout marca as células cobertas e até onde cada tarefa pode crescer', () => {
    const layout = boardLayout([
      makeTask({ id: 1, day: 0, slot: 0, span: 30 }),
      makeTask({ id: 2, day: 1, slot: 2, span: 2 }),
      makeTask({ id: 3, day: 1, slot: 10 }),
      makeTask({ id: 4, span: 5 }),
    ]);
    expect([...layout.starts.keys()].sort()).toEqual(['0:0', '1:10', '1:2']);
    expect(layout.covered.size).toBe(29 + 1);
    expect(layout.covered.get('0:29')?.id).toBe(1);
    expect(layout.covered.get('0:30')).toBeUndefined();
    expect(layout.covered.get('1:3')?.id).toBe(2);
    expect(layout.starts.get('0:0')?.maxSpan).toBe(34);
    expect(layout.starts.get('1:2')?.maxSpan).toBe(8);
    expect(layout.starts.get('1:10')?.maxSpan).toBe(24);
  });

  it('não altera a lista recebida', () => {
    const before = tasks.map((t) => t.id);
    deckTasks(tasks);
    expect(tasks.map((t) => t.id)).toEqual(before);
  });
});
