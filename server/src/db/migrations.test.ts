import { afterEach, describe, expect, it } from 'vitest';
import { createTempDb, type TempDb } from '../../test/helpers/tempDb';
import { MIGRATIONS, migrate, schemaVersion } from './migrations';

let temp: TempDb | undefined;
afterEach(() => {
  temp?.cleanup();
  temp = undefined;
});

const T = '2026-11-13T12:00:00.000Z';

type TaskValues = {
  day: number | null;
  slot: number | null;
  deck: number | null;
  color?: string;
  title?: string;
  content?: string;
  board?: number;
};

/** Insere no schema atual (v3+), no quadro `board` (padrão: o legado, 1). */
function insert(db: TempDb['db'], values: TaskValues) {
  return db
    .prepare(
      'INSERT INTO tasks (board_id, title, color, content, day, slot, deck_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(values.board ?? 1, values.title ?? 'T', values.color ?? 'azul', values.content ?? '{"type":"doc"}', values.day, values.slot, values.deck, T, T);
}

/** Insere num banco antigo (v1/v2), que ainda não tem board_id. */
function insertLegacy(db: TempDb['db'], values: TaskValues) {
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
    insertLegacy(temp.db, { day: null, slot: null, deck: 0 });
    insertLegacy(temp.db, { day: 4, slot: 33, deck: null });
    insertLegacy(temp.db, { day: 0, slot: 0, deck: null });

    expect(migrate(temp.db, MIGRATIONS.slice(0, 2))).toBe(2);
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

describe('migração 3: contas, quadros e membros', () => {
  const NOW = '2026-11-18T12:00:00.000Z';

  function addUser(db: TempDb['db'], sub: string, extra: { username?: string; seq?: number; role?: string } = {}) {
    const hasProfile = extra.username !== undefined;
    return Number(
      db
        .prepare(
          `INSERT INTO users (google_sub, email, display_name, username, seq, role, created_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(sub, `${sub}@example.com`, hasProfile ? 'Nome' : null, extra.username ?? null, extra.seq ?? null, extra.role ?? 'user', NOW, NOW)
        .lastInsertRowid,
    );
  }

  function addBoard(db: TempDb['db'], kind: 'personal' | 'group', owner: number | null) {
    return Number(
      db
        .prepare('INSERT INTO boards (name, kind, owner_user_id, created_at) VALUES (?, ?, ?, ?)')
        .run('Quadro', kind, owner, NOW).lastInsertRowid,
    );
  }

  it('converte um banco v2 com dados: tudo vai para o quadro 1, pessoal e sem dono, com os mesmos ids', () => {
    temp = createTempDb({ migrate: false });
    migrate(temp.db, MIGRATIONS.slice(0, 2));
    insertLegacy(temp.db, { day: null, slot: null, deck: 0, title: 'Deck' });
    insertLegacy(temp.db, { day: 2, slot: 4, deck: null, title: 'Quadro' });
    const deleted = insertLegacy(temp.db, { day: null, slot: null, deck: 1, title: 'Apagada' }).lastInsertRowid;
    temp.db.prepare('DELETE FROM tasks WHERE id = ?').run(deleted);

    expect(migrate(temp.db, MIGRATIONS.slice(0, 3))).toBe(3);
    const tasks = temp.db.prepare('SELECT id, board_id, title, created_by FROM tasks ORDER BY id').all();
    expect(tasks).toEqual([
      { id: 1, board_id: 1, title: 'Deck', created_by: null },
      { id: 2, board_id: 1, title: 'Quadro', created_by: null },
    ]);
    expect(temp.db.prepare('SELECT id, kind, owner_user_id, version FROM boards').all()).toEqual([
      { id: 1, kind: 'personal', owner_user_id: null, version: 0 },
    ]);
    expect(temp.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    // O id apagado (3) não é reutilizado.
    expect(Number(insert(temp.db, { day: null, slot: null, deck: 2 }).lastInsertRowid)).toBe(4);
    expect(temp.db.prepare("SELECT value FROM counters WHERE name = 'next_user_seq'").get()).toEqual({ value: 1 });
  });

  it('a célula e a sobreposição são por quadro; a tarefa não muda de quadro; apagar o quadro apaga as tarefas', () => {
    temp = createTempDb();
    const other = addBoard(temp.db, 'group', null);
    insert(temp.db, { day: 0, slot: 0, deck: null, board: 1 });
    expect(() => insert(temp!.db, { day: 0, slot: 0, deck: null, board: other })).not.toThrow();
    expect(() => insert(temp!.db, { day: 0, slot: 0, deck: null, board: 1 })).toThrow(/Faixa de horário sobreposta/);
    const moved = insert(temp.db, { day: null, slot: null, deck: 0, board: 1 }).lastInsertRowid;
    expect(() => temp!.db.prepare('UPDATE tasks SET board_id = ? WHERE id = ?').run(other, moved)).toThrow(
      /não muda de quadro/,
    );
    temp.db.prepare('DELETE FROM boards WHERE id = ?').run(other);
    expect(temp.db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE board_id = ?').get(other)).toEqual({ n: 0 });
    expect(() => insert(temp!.db, { day: null, slot: null, deck: 5, board: 999 })).toThrow(/FOREIGN KEY/);
  });

  it('usuários: perfil completo ou nenhum, seq único e admin só com seq 0', () => {
    temp = createTempDb();
    addUser(temp.db, 'pendente');
    addUser(temp.db, 'admin', { username: 'ana', seq: 0, role: 'admin' });
    expect(() => addUser(temp!.db, 'outro', { username: 'bia', seq: 0 })).toThrow(/UNIQUE/);
    expect(() => addUser(temp!.db, 'falso', { username: 'cid', seq: 3, role: 'admin' })).toThrow(/constraint/i);
    expect(() => addUser(temp!.db, 'mal', { username: 'Maiúscula', seq: 4 })).toThrow(/constraint/i);
    expect(() =>
      temp!.db
        .prepare('INSERT INTO users (google_sub, email, username, seq, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run('sem-nome', 'x@example.com', 'dan', 5, NOW, NOW),
    ).toThrow(/constraint/i);
    expect(() => addUser(temp!.db, 'admin')).toThrow(/UNIQUE/);
  });

  it('membros: um owner por quadro, owner sempre ativo e o quadro pessoal não aceita membros', () => {
    temp = createTempDb();
    const ana = addUser(temp.db, 'ana', { username: 'ana', seq: 1 });
    const bia = addUser(temp.db, 'bia', { username: 'bia', seq: 2 });
    const personal = addBoard(temp.db, 'personal', ana);
    const group = addBoard(temp.db, 'group', null);
    const member = temp.db.prepare(
      'INSERT INTO board_members (board_id, user_id, role, status, invited_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    member.run(personal, ana, 'owner', 'active', null, NOW);
    expect(() => member.run(personal, bia, 'editor', 'invited', ana, NOW)).toThrow(/não aceita membros/);
    member.run(group, ana, 'owner', 'active', null, NOW);
    expect(() => member.run(group, bia, 'owner', 'active', null, NOW)).toThrow(/UNIQUE/);
    expect(() => member.run(group, bia, 'editor', 'pending', ana, NOW)).toThrow(/constraint/i);
    member.run(group, bia, 'editor', 'invited', ana, NOW);
    expect(() => addBoard(temp!.db, 'personal', ana)).toThrow(/UNIQUE/);
    expect(() => addBoard(temp!.db, 'group', ana)).toThrow(/constraint/i);
    // Apagar a conta leva o quadro pessoal (cascata) e os vínculos.
    temp.db.prepare('DELETE FROM users WHERE id = ?').run(ana);
    expect(temp.db.prepare('SELECT COUNT(*) AS n FROM boards WHERE id = ?').get(personal)).toEqual({ n: 0 });
    expect(temp.db.prepare('SELECT invited_by FROM board_members WHERE user_id = ?').get(bia)).toEqual({ invited_by: null });
  });
});

describe('migração 4: bloqueio de reconvite, disabled_at e índices', () => {
  const NOW = '2026-11-19T12:00:00.000Z';

  function addUser(db: TempDb['db'], sub: string, status: 'active' | 'disabled' = 'active') {
    return Number(
      db
        .prepare(
          `INSERT INTO users (google_sub, email, display_name, username, seq, status, created_at, last_seen_at)
           VALUES (?, ?, 'Nome', ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM users), ?, ?, ?)`,
        )
        .run(sub, `${sub}@example.com`, sub, status, NOW, NOW).lastInsertRowid,
    );
  }

  it('converte um banco v3 com contas: a desativada ganha disabled_at, as outras ficam nulas', () => {
    temp = createTempDb({ migrate: false });
    migrate(temp.db, MIGRATIONS.slice(0, 3));
    const ana = addUser(temp.db, 'ana');
    const bia = addUser(temp.db, 'bia', 'disabled');

    expect(migrate(temp.db)).toBe(MIGRATIONS.length);
    expect(schemaVersion(temp.db)).toBe(4);
    const disabledAt = temp.db.prepare('SELECT id, disabled_at FROM users ORDER BY id').all();
    expect(disabledAt).toEqual([
      { id: ana, disabled_at: null },
      { id: bia, disabled_at: NOW },
    ]);
    expect(temp.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    const indexes = (temp.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>).map(
      (row) => row.name,
    );
    for (const name of [
      'invite_blocks_inviter',
      'invite_blocks_created',
      'users_status_seen',
      'sessions_expires',
      'audit_log_actor',
      'audit_log_target',
      'tasks_created_by',
      'board_members_invited_by',
    ]) {
      expect(indexes, name).toContain(name);
    }
  });

  it('invite_blocks: um por par, nunca da pessoa para ela mesma, e some com qualquer uma das contas', () => {
    temp = createTempDb();
    const ana = addUser(temp.db, 'ana');
    const bia = addUser(temp.db, 'bia');
    const cris = addUser(temp.db, 'cris');
    const block = temp.db.prepare('INSERT INTO invite_blocks (invitee_id, inviter_id, created_at) VALUES (?, ?, ?)');
    block.run(bia, ana, NOW);
    block.run(cris, ana, NOW);
    expect(() => block.run(bia, ana, NOW)).toThrow(/UNIQUE|PRIMARY/);
    expect(() => block.run(ana, ana, NOW)).toThrow(/constraint/i);
    expect(() => block.run(bia, 999, NOW)).toThrow(/FOREIGN KEY/);

    temp.db.prepare('DELETE FROM users WHERE id = ?').run(ana);
    expect(temp.db.prepare('SELECT COUNT(*) AS n FROM invite_blocks').get()).toEqual({ n: 0 });
  });
});
