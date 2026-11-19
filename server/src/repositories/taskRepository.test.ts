import { MoveError } from '@quadro/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTempDb, type TempDb } from '../../test/helpers/tempDb';
import { fixedNow } from '../clock';
import { createTaskStore, type TaskRepository } from './taskRepository';

let temp: TempDb;
let repo: TaskRepository;

beforeEach(() => {
  temp = createTempDb();
  repo = createTaskStore(temp.db, fixedNow('2026-11-13T12:00:00.000Z')).forBoard(1);
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
    const later = createTaskStore(temp.db, fixedNow('2026-11-14T08:00:00.000Z')).forBoard(1);
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

  describe('duração (span)', () => {
    const codeOf = (fn: () => unknown): string | undefined => {
      try {
        fn();
        return undefined;
      } catch (error) {
        return error instanceof MoveError ? error.code : String(error);
      }
    };

    it('cria com span (no deck ou já agendada) e o padrão é 1', () => {
      expect(repo.create({ title: 'A' }).span).toBe(1);
      expect(repo.create({ title: 'B', span: 4 })).toMatchObject({ span: 4, day: null });
      expect(repo.create({ title: 'C', span: 30, position: { kind: 'cell', day: 0, slot: 0 } })).toMatchObject({
        span: 30,
        day: 0,
        slot: 0,
      });
    });

    it('criar numa faixa que cruza outra tarefa dá OCCUPIED, e que passa de 22:00 dá INVALID_TARGET', () => {
      repo.create({ title: 'A', position: { kind: 'cell', day: 0, slot: 4 } });
      expect(codeOf(() => repo.create({ title: 'B', span: 2, position: { kind: 'cell', day: 0, slot: 3 } }))).toBe('OCCUPIED');
      expect(codeOf(() => repo.create({ title: 'C', span: 5, position: { kind: 'cell', day: 1, slot: 30 } }))).toBe(
        'INVALID_TARGET',
      );
      expect(repo.list().map((t) => t.title)).toEqual(['A']);
      expect(temp.db.isTransaction).toBe(false);
    });

    it('tarefas adjacentes convivem', () => {
      repo.create({ title: 'A', span: 2, position: { kind: 'cell', day: 0, slot: 0 } });
      expect(() => repo.create({ title: 'B', span: 3, position: { kind: 'cell', day: 0, slot: 2 } })).not.toThrow();
      expect(positions()).toEqual({ A: '0:0', B: '0:2' });
    });

    it('mudar só o span no lugar: cresce até a tarefa de baixo, além disso dá OCCUPIED e nada muda', () => {
      const a = repo.create({ title: 'A', position: { kind: 'cell', day: 2, slot: 0 } });
      repo.create({ title: 'B', position: { kind: 'cell', day: 2, slot: 3 } });
      expect(repo.update(a.id, { span: 3 })).toMatchObject({ span: 3, day: 2, slot: 0 });
      expect(codeOf(() => repo.update(a.id, { title: 'A2', span: 4 }))).toBe('OCCUPIED');
      expect(repo.get(a.id)).toMatchObject({ title: 'A', span: 3 });
      expect(temp.db.isTransaction).toBe(false);
      expect(repo.update(a.id, { span: 1 })).toMatchObject({ span: 1 });
    });

    it('mudar o span estourando 22:00 dá INVALID_TARGET; no deck qualquer span vale', () => {
      const a = repo.create({ title: 'A', position: { kind: 'cell', day: 0, slot: 32 } });
      expect(codeOf(() => repo.update(a.id, { span: 3 }))).toBe('INVALID_TARGET');
      expect(repo.get(a.id)?.span).toBe(1);
      const b = repo.create({ title: 'B' });
      expect(repo.update(b.id, { span: 34 })).toMatchObject({ span: 34, day: null });
    });

    it('span e position na mesma edição: valida com o span novo e grava tudo junto', () => {
      repo.create({ title: 'A', position: { kind: 'cell', day: 1, slot: 10 } });
      const b = repo.create({ title: 'B', span: 6, position: { kind: 'cell', day: 1, slot: 0 } });
      // Para baixo, encolhendo para caber antes de A.
      expect(repo.update(b.id, { span: 2, position: { kind: 'cell', day: 1, slot: 8 } })).toMatchObject({
        span: 2,
        day: 1,
        slot: 8,
      });
      // Crescendo sobre A: recusa e mantém tudo.
      expect(codeOf(() => repo.update(b.id, { span: 3, position: { kind: 'cell', day: 1, slot: 8 } }))).toBe('OCCUPIED');
      expect(repo.get(b.id)).toMatchObject({ span: 2, slot: 8 });
      // Para o deck crescendo: no deck não há conflito.
      expect(repo.update(b.id, { span: 30, position: { kind: 'deck' } })).toMatchObject({ span: 30, day: null });
      // Vindo de uma faixa que não caberia com o span antigo (o CHECK não pode disparar no meio).
      expect(repo.update(b.id, { span: 4, position: { kind: 'cell', day: 3, slot: 30 } })).toMatchObject({
        span: 4,
        day: 3,
        slot: 30,
      });
    });

    it('o arraste troca blocos do mesmo tamanho e recusa tamanhos diferentes sem mexer em nada', () => {
      const a = repo.create({ title: 'A', span: 2, position: { kind: 'cell', day: 0, slot: 0 } });
      repo.create({ title: 'B', span: 2, position: { kind: 'cell', day: 0, slot: 5 } });
      repo.create({ title: 'C', span: 1, position: { kind: 'cell', day: 4, slot: 0 } });
      repo.move(a.id, { kind: 'cell', day: 0, slot: 6 });
      expect(positions()).toEqual({ A: '0:5', B: '0:0', C: '4:0' });

      expect(codeOf(() => repo.move(a.id, { kind: 'cell', day: 4, slot: 0 }))).toBe('OCCUPIED');
      expect(codeOf(() => repo.move(a.id, { kind: 'cell', day: 4, slot: 33 }))).toBe('INVALID_TARGET');
      expect(positions()).toEqual({ A: '0:5', B: '0:0', C: '4:0' });
      expect(temp.db.isTransaction).toBe(false);
    });

    it('o span sobrevive ao deck, ao quadro e ao reset', () => {
      const a = repo.create({ title: 'A', span: 5 });
      repo.move(a.id, { kind: 'cell', day: 2, slot: 10 });
      repo.move(a.id, { kind: 'deck' });
      repo.move(a.id, { kind: 'cell', day: 1, slot: 0 });
      repo.reset();
      expect(repo.get(a.id)).toMatchObject({ span: 5, day: null });
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
    const again = createTaskStore(temp.reopen(), fixedNow('2026-11-13T12:00:00.000Z')).forBoard(1);
    expect(again.list().map((t) => t.title)).toEqual(['Persistente']);
  });
});

describe('TaskStore: tarefas por quadro', () => {
  const NOW = '2026-11-18T12:00:00.000Z';
  const newBoard = () =>
    Number(
      temp.db
        .prepare("INSERT INTO boards (name, kind, owner_user_id, created_at) VALUES ('Grupo', 'group', NULL, ?)")
        .run(NOW).lastInsertRowid,
    );
  const version = (boardId: number) =>
    (temp.db.prepare('SELECT version FROM boards WHERE id = ?').get(boardId) as { version: number }).version;

  it('cada quadro só enxerga as próprias tarefas, e a tarefa diz a que quadro pertence', () => {
    const store = createTaskStore(temp.db, fixedNow(NOW));
    const other = newBoard();
    const a = store.forBoard(1).create({ title: 'Legado' });
    const b = store.forBoard(other).create({ title: 'Grupo' });
    expect(a.boardId).toBe(1);
    expect(b.boardId).toBe(other);
    expect(store.forBoard(1).list().map((t) => t.title)).toEqual(['Legado']);
    expect(store.forBoard(other).list().map((t) => t.title)).toEqual(['Grupo']);
    expect(store.boardOf(b.id)).toBe(other);
    expect(store.boardOf(9999)).toBeNull();
  });

  it('tarefa de outro quadro não existe aqui: get, update e remove não acham, move dá NOT_FOUND', () => {
    const store = createTaskStore(temp.db, fixedNow(NOW));
    const other = newBoard();
    const foreign = store.forBoard(other).create({ title: 'Alheia' });
    const mine = store.forBoard(1);
    expect(mine.get(foreign.id)).toBeNull();
    expect(mine.update(foreign.id, { title: 'Invadida' })).toBeNull();
    expect(mine.remove(foreign.id)).toBe(false);
    expect(() => mine.move(foreign.id, { kind: 'cell', day: 0, slot: 0 })).toThrow(MoveError);
    expect(store.forBoard(other).get(foreign.id)?.title).toBe('Alheia');
  });

  it('a mesma célula vale em quadros diferentes, e o deck de cada quadro tem a própria ordem', () => {
    const store = createTaskStore(temp.db, fixedNow(NOW));
    const other = newBoard();
    store.forBoard(1).create({ title: 'A', position: { kind: 'cell', day: 0, slot: 0 } });
    expect(() => store.forBoard(other).create({ title: 'B', position: { kind: 'cell', day: 0, slot: 0 } })).not.toThrow();
    expect(store.forBoard(other).create({ title: 'C' }).deckOrder).toBe(0);
  });

  it('created_by registra quem criou', () => {
    const user = Number(
      temp.db
        .prepare(
          "INSERT INTO users (google_sub, email, display_name, username, seq, created_at, last_seen_at) VALUES ('s', 's@example.com', 'S', 'sss', 1, ?, ?)",
        )
        .run(NOW, NOW).lastInsertRowid,
    );
    const task = createTaskStore(temp.db, fixedNow(NOW)).forBoard(1, user).create({ title: 'Minha' });
    expect(temp.db.prepare('SELECT created_by FROM tasks WHERE id = ?').get(task.id)).toEqual({ created_by: user });
  });

  it('a versão do quadro sobe a cada mudança real e não sobe quando nada muda', () => {
    const store = createTaskStore(temp.db, fixedNow(NOW));
    const board = store.forBoard(1);
    const start = version(1);
    const a = board.create({ title: 'A' });
    expect(version(1)).toBe(start + 1);
    board.move(a.id, { kind: 'deck' });
    expect(version(1)).toBe(start + 1);
    board.move(a.id, { kind: 'cell', day: 1, slot: 1 });
    expect(version(1)).toBe(start + 2);
    board.update(a.id, { title: 'A2' });
    expect(version(1)).toBe(start + 3);
    board.reset();
    expect(version(1)).toBe(start + 4);
    board.reset();
    expect(version(1)).toBe(start + 4);
    expect(board.remove(9999)).toBe(false);
    expect(version(1)).toBe(start + 4);
    board.remove(a.id);
    expect(version(1)).toBe(start + 5);
  });
});
