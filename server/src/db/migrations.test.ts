import { afterEach, describe, expect, it } from 'vitest';
import { createTempDb, type TempDb } from '../../test/helpers/tempDb';
import { MIGRATIONS, migrate, schemaVersion } from './migrations';

let temp: TempDb | undefined;
afterEach(() => {
  temp?.cleanup();
  temp = undefined;
});

const T = '2026-11-13T12:00:00.000Z';

function insert(db: TempDb['db'], values: { day: number | null; slot: number | null; deck: number | null; color?: string; title?: string; content?: string }) {
  return db
    .prepare('INSERT INTO tasks (title, color, content, day, slot, deck_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(values.title ?? 'T', values.color ?? 'azul', values.content ?? '{"type":"doc"}', values.day, values.slot, values.deck, T, T);
}

describe('migrate', () => {
  it('cria o schema e grava user_version', () => {
    temp = createTempDb({ migrate: false });
    expect(schemaVersion(temp.db)).toBe(0);
    expect(migrate(temp.db)).toBe(MIGRATIONS.length);
    expect(schemaVersion(temp.db)).toBe(MIGRATIONS.length);
  });

  it('é idempotente', () => {
    temp = createTempDb();
    expect(() => migrate(temp!.db)).not.toThrow();
    expect(schemaVersion(temp.db)).toBe(MIGRATIONS.length);
  });

  it('recusa banco mais novo que a aplicação', () => {
    temp = createTempDb();
    temp.db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
    expect(() => migrate(temp!.db)).toThrow(/mais nova/);
  });

  it('desfaz a migração que falhar', () => {
    temp = createTempDb({ migrate: false });
    expect(() => migrate(temp!.db, ['CREATE TABLE ok (a)', 'CREATE TABLE ruim ('])).toThrow();
    expect(schemaVersion(temp.db)).toBe(1);
  });
});

describe('restrições da tabela tasks', () => {
  it('aceita tarefa no deck e tarefa numa célula', () => {
    temp = createTempDb();
    expect(() => insert(temp!.db, { day: null, slot: null, deck: 0 })).not.toThrow();
    expect(() => insert(temp!.db, { day: 4, slot: 33, deck: null })).not.toThrow();
  });

  it('impede duas tarefas na mesma célula', () => {
    temp = createTempDb();
    insert(temp.db, { day: 1, slot: 2, deck: null });
    // O trigger de sobreposição dispara antes do índice único.
    expect(() => insert(temp!.db, { day: 1, slot: 2, deck: null })).toThrow(/Faixa de horário sobreposta/);
  });

  it.each([
    ['deck e célula ao mesmo tempo', { day: 0, slot: 0, deck: 1 }],
    ['nem deck nem célula', { day: null, slot: null, deck: null }],
    ['dia sem horário', { day: 0, slot: null, deck: null }],
    ['dia fora do intervalo', { day: 5, slot: 0, deck: null }],
    ['horário fora do intervalo', { day: 0, slot: 34, deck: null }],
    ['cor desconhecida', { day: null, slot: null, deck: 0, color: 'red' }],
    ['título vazio', { day: null, slot: null, deck: 0, title: '' }],
    ['conteúdo que não é JSON', { day: null, slot: null, deck: 0, content: '<b>oi</b>' }],
  ])('rejeita %s', (_label, values) => {
    temp = createTempDb();
    expect(() => insert(temp!.db, values)).toThrow(/constraint/i);
  });
});

describe('migração 2: duração (span)', () => {
  const setSpan = (db: TempDb['db'], id: number | bigint, span: number) =>
    db.prepare('UPDATE tasks SET span = ? WHERE id = ?').run(span, id);
  const spans = (db: TempDb['db']) =>
    (db.prepare('SELECT id, span FROM tasks ORDER BY id').all() as Array<{ id: number; span: number }>).map((r) => r.span);

  it('converte um banco da versão 1 com dados: todas as tarefas ficam com span 1', () => {
    temp = createTempDb({ migrate: false });
    migrate(temp.db, MIGRATIONS.slice(0, 1));
    expect(schemaVersion(temp.db)).toBe(1);
    insert(temp.db, { day: null, slot: null, deck: 0 });
    insert(temp.db, { day: 4, slot: 33, deck: null });
    insert(temp.db, { day: 0, slot: 0, deck: null });

    expect(migrate(temp.db)).toBe(2);
    expect(schemaVersion(temp.db)).toBe(2);
    expect(spans(temp.db)).toEqual([1, 1, 1]);
  });

  it('span fica entre 1 e 34 e a faixa não passa de 22:00; no deck vale qualquer span', () => {
    temp = createTempDb();
    const deckTask = insert(temp.db, { day: null, slot: null, deck: 0 }).lastInsertRowid;
    const lastSlot = insert(temp.db, { day: 1, slot: 33, deck: null }).lastInsertRowid;
    expect(() => setSpan(temp!.db, deckTask, 34)).not.toThrow();
    expect(() => setSpan(temp!.db, deckTask, 0)).toThrow(/constraint/i);
    expect(() => setSpan(temp!.db, deckTask, 35)).toThrow(/constraint/i);
    expect(() => setSpan(temp!.db, lastSlot, 2)).toThrow(/constraint/i);
  });

  it('o banco recusa faixas sobrepostas ao inserir e ao atualizar', () => {
    temp = createTempDb();
    const a = insert(temp.db, { day: 0, slot: 0, deck: null }).lastInsertRowid;
    setSpan(temp.db, a, 3);
    // Começa dentro da faixa de A (slot 2): o índice único não pegaria, o trigger pega.
    expect(() => insert(temp!.db, { day: 0, slot: 2, deck: null })).toThrow(/Faixa de horário sobreposta/);
    const b = insert(temp.db, { day: 0, slot: 3, deck: null }).lastInsertRowid;
    // A crescendo sobre B.
    expect(() => setSpan(temp!.db, a, 4)).toThrow(/Faixa de horário sobreposta/);
    // B movendo para dentro de A.
    expect(() =>
      temp!.db.prepare('UPDATE tasks SET slot = ? WHERE id = ?').run(1, b),
    ).toThrow(/Faixa de horário sobreposta/);
    // Outro dia e faixas adjacentes são aceitos.
    expect(() => insert(temp!.db, { day: 1, slot: 2, deck: null })).not.toThrow();
    expect(spans(temp.db)).toEqual([3, 1, 1]);
  });
});
