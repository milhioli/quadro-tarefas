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
  // 3: contas, sessões, quadros e membros (Fase 2a, docs/fase-2a.md).
  // - O acesso a um quadro vem só de board_members (inclusive o owner do pessoal).
  // - As tarefas de antes vão para o quadro 1, pessoal e sem dono, que o admin
  //   (QUADRO_ADMIN_EMAIL) reclama ao criar o perfil.
  // - tasks é recriada (o SQLite não acrescenta coluna NOT NULL com FK); índices
  //   e triggers passam a ser por quadro, e a tarefa não muda de quadro.
  `
  CREATE TABLE users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    google_sub   TEXT    NOT NULL UNIQUE CHECK (length(google_sub) BETWEEN 1 AND 255),
    email        TEXT    NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
    display_name TEXT    CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 40),
    username     TEXT    CHECK (username IS NULL OR (length(username) BETWEEN 3 AND 20 AND username NOT GLOB '*[^a-z0-9._]*')),
    seq          INTEGER UNIQUE CHECK (seq IS NULL OR seq >= 0),
    role         TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
    status       TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
    created_at   TEXT    NOT NULL,
    last_seen_at TEXT    NOT NULL,
    CHECK ((username IS NULL) = (seq IS NULL)),
    CHECK ((username IS NULL) = (display_name IS NULL)),
    CHECK (role = 'user' OR seq IS 0)
  );
  CREATE TABLE sessions (
    id_hash      TEXT    PRIMARY KEY CHECK (length(id_hash) = 64),
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TEXT    NOT NULL,
    expires_at   TEXT    NOT NULL,
    last_seen_at TEXT    NOT NULL
  ) WITHOUT ROWID;
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE counters (
    name  TEXT    PRIMARY KEY,
    value INTEGER NOT NULL CHECK (value >= 1)
  ) WITHOUT ROWID;
  INSERT INTO counters (name, value) VALUES ('next_user_seq', 1);
  CREATE TABLE boards (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
    kind          TEXT    NOT NULL CHECK (kind IN ('personal','group')),
    owner_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    version       INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL,
    CHECK (kind = 'personal' OR owner_user_id IS NULL)
  );
  CREATE UNIQUE INDEX boards_one_personal ON boards(owner_user_id) WHERE kind = 'personal';
  CREATE TABLE board_members (
    board_id   INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    role       TEXT    NOT NULL CHECK (role IN ('owner','editor')),
    status     TEXT    NOT NULL CHECK (status IN ('invited','active')),
    invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT    NOT NULL,
    PRIMARY KEY (board_id, user_id),
    CHECK (role = 'editor' OR status = 'active')
  ) WITHOUT ROWID;
  CREATE INDEX board_members_user ON board_members(user_id, status);
  CREATE UNIQUE INDEX board_members_one_owner ON board_members(board_id) WHERE role = 'owner';
  CREATE TRIGGER board_members_personal BEFORE INSERT ON board_members
  WHEN (SELECT kind FROM boards WHERE id = NEW.board_id) = 'personal' AND NEW.role <> 'owner'
  BEGIN
    SELECT RAISE(ABORT, 'Quadro pessoal não aceita membros');
  END;
  CREATE TABLE audit_log (
    id            INTEGER PRIMARY KEY,
    at            TEXT    NOT NULL,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action        TEXT    NOT NULL CHECK (length(action) BETWEEN 1 AND 40),
    target_kind   TEXT    CHECK (target_kind IN ('user','board')),
    target_id     INTEGER
  );
  CREATE INDEX audit_log_at ON audit_log(at);

  -- Quadro legado: criado ANTES da cópia das tarefas (a FK board_id é conferida nela).
  INSERT INTO boards (id, name, kind, owner_user_id, version, created_at)
  VALUES (1, 'Meu quadro', 'personal', NULL, 0,
          COALESCE((SELECT MIN(created_at) FROM tasks), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));

  CREATE TABLE tasks_new (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id   INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    title      TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
    color      TEXT    NOT NULL DEFAULT 'amarelo'
               CHECK (color IN ('amarelo','azul','verde','rosa','roxo','laranja','cinza')),
    content    TEXT    NOT NULL CHECK (json_valid(content)),
    day        INTEGER CHECK (day BETWEEN 0 AND 4),
    slot       INTEGER CHECK (slot BETWEEN 0 AND 33),
    span       INTEGER NOT NULL DEFAULT 1 CHECK (span BETWEEN 1 AND 34 AND (day IS NULL OR slot + span <= 34)),
    deck_order INTEGER,
    created_at TEXT    NOT NULL,
    updated_at TEXT    NOT NULL,
    CHECK ((day IS NULL AND slot IS NULL AND deck_order IS NOT NULL)
        OR (day IS NOT NULL AND slot IS NOT NULL AND deck_order IS NULL))
  );
  INSERT INTO tasks_new (id, board_id, created_by, title, color, content, day, slot, span, deck_order, created_at, updated_at)
    SELECT id, 1, NULL, title, color, content, day, slot, span, deck_order, created_at, updated_at FROM tasks;
  -- Mantém o "nunca reutiliza id" do AUTOINCREMENT (o DROP apaga a linha 'tasks'; o RENAME renomeia a de 'tasks_new').
  UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'tasks'), 0))
    WHERE name = 'tasks_new';
  INSERT INTO sqlite_sequence (name, seq) SELECT 'tasks_new', seq FROM sqlite_sequence
    WHERE name = 'tasks' AND NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'tasks_new');
  DROP TABLE tasks;
  ALTER TABLE tasks_new RENAME TO tasks;
  CREATE UNIQUE INDEX tasks_cell_unique ON tasks(board_id, day, slot) WHERE day IS NOT NULL;
  CREATE INDEX tasks_deck_order ON tasks(board_id, deck_order) WHERE deck_order IS NOT NULL;
  CREATE INDEX tasks_board ON tasks(board_id);
  CREATE TRIGGER tasks_no_overlap_insert BEFORE INSERT ON tasks
  WHEN NEW.day IS NOT NULL
  BEGIN
    SELECT RAISE(ABORT, 'Faixa de horário sobreposta')
    WHERE EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.board_id = NEW.board_id AND t.day = NEW.day
        AND t.slot < NEW.slot + NEW.span AND NEW.slot < t.slot + t.span
    );
  END;
  CREATE TRIGGER tasks_no_overlap_update BEFORE UPDATE OF day, slot, span ON tasks
  WHEN NEW.day IS NOT NULL
  BEGIN
    SELECT RAISE(ABORT, 'Faixa de horário sobreposta')
    WHERE EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id <> NEW.id AND t.board_id = NEW.board_id AND t.day = NEW.day
        AND t.slot < NEW.slot + NEW.span AND NEW.slot < t.slot + t.span
    );
  END;
  CREATE TRIGGER tasks_board_immutable BEFORE UPDATE OF board_id ON tasks
  WHEN NEW.board_id IS NOT OLD.board_id
  BEGIN
    SELECT RAISE(ABORT, 'A tarefa não muda de quadro');
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
