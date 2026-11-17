import { MoveError } from '@quadro/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTempDb, type TempDb } from '../../test/helpers/tempDb';
import { fixedNow } from '../clock';
import { createTaskRepository, type TaskRepository } from './taskRepository';

let temp: TempDb;
let repo: TaskRepository;

beforeEach(() => {
  temp = createTempDb();
  repo = createTaskRepository(temp.db, fixedNow('2026-11-13T12:00:00.000Z'));
});
afterEach(() => temp.cleanup());

const positions = () =>
  Object.fromEntries(repo.list().map((t) => [t.title, t.day === null ? `deck:${t.deckOrder}` : `${t.day}:${t.slot}`]));

describe('taskRepository', () => {
  it('cria tarefas no fim do deck com padrões e carimbo do relógio injetado', () => {
    const a = repo.create({ title: 'A' });
    const b = repo.create({ title: 'B', color: 'verde' });
    expect(a).toMatchObject({
      title: 'A',
      color: 'amarelo',
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      day: null,
      slot: null,
      deckOrder: 0,
      createdAt: '2026-11-13T12:00:00.000Z',
      updatedAt: '2026-11-13T12:00:00.000Z',
    });
    expect(b.deckOrder).toBe(1);
    expect(b.color).toBe('verde');
  });

  it('get devolve null para id inexistente', () => {
    expect(repo.get(999)).toBeNull();
  });

  it('atualiza título, cor e conteúdo preservando o resto', () => {
    const task = repo.create({ title: 'A' });
    const later = createTaskRepository(temp.db, fixedNow('2026-11-14T08:00:00.000Z'));
    const content = { type: 'doc' as const, content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph' }] }] }] };
    const updated = later.update(task.id, { title: 'A2', content });
    expect(updated).toMatchObject({ title: 'A2', color: 'amarelo', content, createdAt: task.createdAt, updatedAt: '2026-11-14T08:00:00.000Z' });
    expect(repo.update(999, { title: 'x' })).toBeNull();
  });

  it('remove tarefa e libera a célula', () => {
    const a = repo.create({ title: 'A' });
    repo.move(a.id, { kind: 'cell', day: 0, slot: 0 });
    expect(repo.remove(a.id)).toBe(true);
    expect(repo.remove(a.id)).toBe(false);
    const b = repo.create({ title: 'B' });
    expect(() => repo.move(b.id, { kind: 'cell', day: 0, slot: 0 })).not.toThrow();
  });

  it('move do deck para célula vazia e de volta ao deck', () => {
    const a = repo.create({ title: 'A' });
    repo.create({ title: 'B' });
    repo.move(a.id, { kind: 'cell', day: 2, slot: 10 });
    expect(positions()).toEqual({ A: '2:10', B: 'deck:1' });
    repo.move(a.id, { kind: 'deck' });
    expect(positions()).toEqual({ A: 'deck:2', B: 'deck:1' });
  });

  it('troca duas tarefas de célula sem violar o índice único', () => {
    const a = repo.create({ title: 'A' });
    const b = repo.create({ title: 'B' });
    repo.move(a.id, { kind: 'cell', day: 0, slot: 0 });
    repo.move(b.id, { kind: 'cell', day: 1, slot: 1 });
    repo.move(a.id, { kind: 'cell', day: 1, slot: 1 });
    expect(positions()).toEqual({ A: '1:1', B: '0:0' });
  });

  it('deck → célula ocupada devolve o ocupante ao deck', () => {
    const a = repo.create({ title: 'A' });
    const b = repo.create({ title: 'B' });
    repo.move(a.id, { kind: 'cell', day: 3, slot: 3 });
    repo.move(b.id, { kind: 'cell', day: 3, slot: 3 });
    expect(positions()).toEqual({ A: 'deck:1', B: '3:3' });
  });

  it('lança MoveError NOT_FOUND e não altera nada', () => {
    const a = repo.create({ title: 'A' });
    expect(() => repo.move(999, { kind: 'deck' })).toThrow(MoveError);
    expect(repo.get(a.id)?.deckOrder).toBe(0);
    expect(temp.db.isTransaction).toBe(false);
  });

  it('cria já agendada quando recebe position livre', () => {
    repo.create({ title: 'A' });
    const b = repo.create({ title: 'B', position: { kind: 'cell', day: 2, slot: 4 } });
    expect(b).toMatchObject({ day: 2, slot: 4, deckOrder: null });
    expect(positions()).toEqual({ A: 'deck:0', B: '2:4' });
    expect(repo.create({ title: 'C', position: { kind: 'deck' } }).deckOrder).toBe(1);
  });

  it('criar em célula ocupada lança OCCUPIED e não cria nada', () => {
    repo.create({ title: 'A', position: { kind: 'cell', day: 0, slot: 0 } });
    try {
      repo.create({ title: 'B', position: { kind: 'cell', day: 0, slot: 0 } });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MoveError);
      expect((error as MoveError).code).toBe('OCCUPIED');
    }
    expect(repo.list().map((t) => t.title)).toEqual(['A']);
    expect(temp.db.isTransaction).toBe(false);
  });

  it('editar com position move a tarefa na mesma operação', () => {
    const a = repo.create({ title: 'A' });
    const moved = repo.update(a.id, { title: 'A2', position: { kind: 'cell', day: 4, slot: 33 } });
    expect(moved).toMatchObject({ title: 'A2', day: 4, slot: 33, deckOrder: null });
    // Sozinha no quadro, ela volta para a primeira posição do deck.
    const back = repo.update(a.id, { position: { kind: 'deck' } });
    expect(back).toMatchObject({ day: null, slot: null, deckOrder: 0 });
  });

  it('editar para célula ocupada lança OCCUPIED e nenhum campo muda', () => {
    const a = repo.create({ title: 'A', position: { kind: 'cell', day: 1, slot: 1 } });
    const b = repo.create({ title: 'B' });
    expect(() => repo.update(b.id, { title: 'B2', color: 'rosa', position: { kind: 'cell', day: 1, slot: 1 } })).toThrow(
      MoveError,
    );
    expect(repo.get(b.id)).toMatchObject({ title: 'B', color: 'amarelo', day: null, deckOrder: b.deckOrder });
    expect(repo.get(a.id)).toMatchObject({ day: 1, slot: 1 });
    expect(temp.db.isTransaction).toBe(false);
  });

  it('editar mantendo a própria célula não é conflito', () => {
    const a = repo.create({ title: 'A', position: { kind: 'cell', day: 3, slot: 3 } });
    expect(repo.update(a.id, { title: 'A2', position: { kind: 'cell', day: 3, slot: 3 } })).toMatchObject({
      title: 'A2',
      day: 3,
      slot: 3,
    });
  });

  it('reset devolve tudo ao deck em ordem de dia e horário', () => {
    const a = repo.create({ title: 'A' });
    const b = repo.create({ title: 'B' });
    const c = repo.create({ title: 'C' });
    repo.move(a.id, { kind: 'cell', day: 4, slot: 0 });
    repo.move(b.id, { kind: 'cell', day: 0, slot: 5 });
    const result = repo.reset();
    expect(result.moved).toBe(2);
    expect(positions()).toEqual({ C: 'deck:2', B: 'deck:3', A: 'deck:4' });
    expect(result.tasks.map((t) => t.title)).toEqual(['C', 'B', 'A']);
    expect(repo.reset().moved).toBe(0);
    expect(c.deckOrder).toBe(2);
  });

  it('lista o deck primeiro (por ordem) e depois o quadro', () => {
    const a = repo.create({ title: 'A' });
    repo.create({ title: 'B' });
    repo.move(a.id, { kind: 'cell', day: 0, slot: 0 });
    expect(repo.list().map((t) => t.title)).toEqual(['B', 'A']);
  });

  it('conteúdo corrompido no banco vira documento vazio', () => {
    const a = repo.create({ title: 'A' });
    temp.db.prepare('UPDATE tasks SET content = ? WHERE id = ?').run('{"type":"script"}', a.id);
    expect(repo.get(a.id)?.content).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });

  it('persiste entre conexões (reiniciar o servidor)', () => {
    repo.create({ title: 'Persistente' });
    const again = createTaskRepository(temp.reopen(), fixedNow('2026-11-13T12:00:00.000Z'));
    expect(again.list().map((t) => t.title)).toEqual(['Persistente']);
  });
});
