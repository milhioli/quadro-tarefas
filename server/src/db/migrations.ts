import type { DatabaseSync } from 'node:sqlite';
import { withTransaction } from './transaction';

/** Cada item é uma migração; a posição + 1 é o `user_version` resultante. */
export const MIGRATIONS: readonly string[] = Object.freeze([
  `
  CREATE TABLE tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
    color       TEXT    NOT NULL DEFAULT 'amarelo'
                CHECK (color IN ('amarelo','azul','verde','rosa','roxo','laranja','cinza')),
    content     TEXT    NOT NULL CHECK (json_valid(content)),
    day         INTEGER CHECK (day BETWEEN 0 AND 4),
    slot        INTEGER CHECK (slot BETWEEN 0 AND 33),
    deck_order  INTEGER,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL,
    CHECK ((day IS NULL AND slot IS NULL AND deck_order IS NOT NULL)
        OR (day IS NOT NULL AND slot IS NOT NULL AND deck_order IS NULL))
  );
  CREATE UNIQUE INDEX tasks_cell_unique ON tasks(day, slot) WHERE day IS NOT NULL;
  CREATE INDEX tasks_deck_order ON tasks(deck_order) WHERE deck_order IS NOT NULL;
  `,
  // 2: duração. `slot` continua sendo o início; a tarefa ocupa [slot, slot + span).
  // As tarefas existentes ficam com span = 1, que é o comportamento anterior.
  // A regra de não sobrepor vive em shared/src/move.ts (checada dentro da transação);
  // os triggers são a defesa no banco caso algum caminho a pule.
  `
  ALTER TABLE tasks ADD COLUMN span INTEGER NOT NULL DEFAULT 1
    CHECK (span BETWEEN 1 AND 34 AND (day IS NULL OR slot + span <= 34));
  CREATE TRIGGER tasks_no_overlap_insert BEFORE INSERT ON tasks
  WHEN NEW.day IS NOT NULL
  BEGIN
    SELECT RAISE(ABORT, 'Faixa de horário sobreposta')
    WHERE EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.day = NEW.day AND t.slot < NEW.slot + NEW.span AND NEW.slot < t.slot + t.span
    );
  END;
  CREATE TRIGGER tasks_no_overlap_update BEFORE UPDATE OF day, slot, span ON tasks
  WHEN NEW.day IS NOT NULL
  BEGIN
    SELECT RAISE(ABORT, 'Faixa de horário sobreposta')
    WHERE EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id <> NEW.id AND t.day = NEW.day AND t.slot < NEW.slot + NEW.span AND NEW.slot < t.slot + t.span
    );
  END;
  `,
]);

export function schemaVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  return row.user_version;
}

/** Aplica as migrações pendentes, cada uma em sua transação. Devolve a versão final. */
export function migrate(db: DatabaseSync, migrations: readonly string[] = MIGRATIONS): number {
  const current = schemaVersion(db);
  if (current > migrations.length) {
    throw new Error(
      `O banco está na versão ${current}, mais nova que a aplicação (${migrations.length}). Atualize o código.`,
    );
  }
  for (let index = current; index < migrations.length; index++) {
    withTransaction(db, () => {
      db.exec(migrations[index] as string);
      db.exec(`PRAGMA user_version = ${index + 1}`);
    });
  }
  return migrations.length;
}
