import type { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_COLOR,
  emptyDoc,
  isRichDoc,
  isTaskColor,
  planMove,
  planPlacement,
  planReset,
  type CreateTaskInput,
  type MoveTarget,
  type Position,
  type RichDoc,
  type Task,
  type UpdateTaskInput,
} from '@quadro/shared';
import { nowIso, type Now } from '../clock';
import { withTransaction } from '../db/transaction';

interface TaskRow {
  id: number;
  title: string;
  color: string;
  content: string;
  day: number | null;
  slot: number | null;
  span: number;
  deck_order: number | null;
  created_at: string;
  updated_at: string;
}

interface PositionRow {
  id: number;
  day: number | null;
  slot: number | null;
  span: number;
  deck_order: number | null;
}

function parseContent(raw: string): RichDoc {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRichDoc(parsed) ? parsed : emptyDoc();
  } catch {
    return emptyDoc();
  }
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    color: isTaskColor(row.color) ? row.color : DEFAULT_COLOR,
    content: parseContent(row.content),
    day: row.day,
    slot: row.slot,
    span: row.span,
    deckOrder: row.deck_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface TaskRepository {
  list(): Task[];
  get(id: number): Task | null;
  /**
   * Com `position` numa faixa que cruza outra tarefa lança MoveError('OCCUPIED');
   * se não couber até 22:00, MoveError('INVALID_TARGET'). Em ambos, nada é gravado.
   */
  create(input: CreateTaskInput): Task;
  /**
   * Idem para `position` e para `span` (inclusive um span que cresce no lugar
   * sobre a tarefa de baixo). Em erro, nenhum campo muda.
   */
  update(id: number, patch: UpdateTaskInput): Task | null;
  remove(id: number): boolean;
  /** Move a tarefa (o arraste, que troca); lança MoveError('NOT_FOUND') se o id não existir. */
  move(id: number, to: MoveTarget): Task[];
  reset(): { tasks: Task[]; moved: number };
}

export function createTaskRepository(db: DatabaseSync, now: Now): TaskRepository {
  const statements = {
    list: db.prepare(
      `SELECT * FROM tasks
       ORDER BY (day IS NOT NULL), deck_order, day, slot, id`,
    ),
    get: db.prepare('SELECT * FROM tasks WHERE id = ?'),
    positions: db.prepare('SELECT id, day, slot, span, deck_order FROM tasks'),
    nextDeckOrder: db.prepare(
      'SELECT COALESCE(MAX(deck_order), -1) + 1 AS next FROM tasks WHERE deck_order IS NOT NULL',
    ),
    insert: db.prepare(
      `INSERT INTO tasks (title, color, content, span, day, slot, deck_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
    ),
    update: db.prepare('UPDATE tasks SET title = ?, color = ?, content = ?, span = ?, updated_at = ? WHERE id = ?'),
    remove: db.prepare('DELETE FROM tasks WHERE id = ?'),
    setPosition: db.prepare('UPDATE tasks SET day = ?, slot = ?, deck_order = ?, updated_at = ? WHERE id = ?'),
  };

  function readPositions(): Position[] {
    return (statements.positions.all() as unknown as PositionRow[]).map((row) => ({
      id: row.id,
      day: row.day,
      slot: row.slot,
      span: row.span,
      deckOrder: row.deck_order,
    }));
  }

  /**
   * Grava as mudanças em duas fases para nunca violar o índice único de célula
   * nem os triggers de sobreposição:
   * 1) toda tarefa que muda vai provisoriamente ao deck (deck_order = -id);
   * 2) `between`, se houver (ex.: gravar o span novo enquanto a tarefa está fora do quadro);
   * 3) cada uma recebe a posição final.
   * Em qualquer momento o quadro é um subconjunto do estado final, que não se sobrepõe.
   */
  function writePositions(changes: readonly Position[], timestamp: string, between?: () => void): void {
    for (const change of changes) {
      statements.setPosition.run(null, null, -change.id, timestamp, change.id);
    }
    between?.();
    for (const change of changes) {
      statements.setPosition.run(change.day, change.slot, change.deckOrder, timestamp, change.id);
    }
  }

  function list(): Task[] {
    return (statements.list.all() as unknown as TaskRow[]).map(toTask);
  }

  function get(id: number): Task | null {
    const row = statements.get.get(id) as unknown as TaskRow | undefined;
    return row ? toTask(row) : null;
  }

  return {
    list,
    get,

    create(input) {
      return withTransaction(db, () => {
        const timestamp = nowIso(now);
        const { next } = statements.nextDeckOrder.get() as { next: number };
        // Nasce no deck (onde qualquer span é válido) e só depois vai para a célula.
        const result = statements.insert.run(
          input.title,
          input.color ?? DEFAULT_COLOR,
          JSON.stringify(input.content ?? emptyDoc()),
          input.span ?? 1,
          next,
          timestamp,
          timestamp,
        );
        const id = Number(result.lastInsertRowid);
        // Na mesma transação: se a faixa estiver ocupada, o INSERT é desfeito.
        if (input.position) writePositions(planPlacement(readPositions(), id, input.position), timestamp);
        return get(id) as Task;
      });
    },

    update(id, patch) {
      return withTransaction(db, () => {
        const current = get(id);
        if (!current) return null;
        const timestamp = nowIso(now);
        const span = patch.span ?? current.span;

        // Valida tudo em memória, já com o span novo, antes de gravar qualquer coisa.
        // Span que muda sem `position` é checado na própria célula (redimensionar).
        const positions = readPositions().map((p) => (p.id === id ? { ...p, span } : p));
        const keepCell =
          patch.span !== undefined && current.day !== null && current.slot !== null
            ? ({ kind: 'cell', day: current.day, slot: current.slot } as const)
            : undefined;
        const target = patch.position ?? keepCell;
        const changes = target ? planPlacement(positions, id, target) : [];

        writePositions(changes, timestamp, () => {
          statements.update.run(
            patch.title ?? current.title,
            patch.color ?? current.color,
            JSON.stringify(patch.content ?? current.content),
            span,
            timestamp,
            id,
          );
        });
        return get(id);
      });
    },

    remove(id) {
      return Number(statements.remove.run(id).changes) > 0;
    },

    move(id, to) {
      withTransaction(db, () => {
        const changes = planMove(readPositions(), id, to);
        writePositions(changes, nowIso(now));
      });
      return list();
    },

    reset() {
      const moved = withTransaction(db, () => {
        const changes = planReset(readPositions());
        writePositions(changes, nowIso(now));
        return changes.length;
      });
      return { tasks: list(), moved };
    },
  };
}
