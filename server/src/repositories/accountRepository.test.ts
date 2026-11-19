import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTempDb, type TempDb } from '../../test/helpers/tempDb';
import { fixedNow, type Now } from '../clock';
import { createAccountRepository, type AccountRepository } from './accountRepository';
import { createAuditRepository } from './auditRepository';
import { createBoardRepository, type BoardRepository } from './boardRepository';
import { createSessionRepository } from './sessionRepository';
import { createTaskStore } from './taskRepository';
import { createUserRepository } from './userRepository';

let temp: TempDb;
let boards: BoardRepository;
let accounts: AccountRepository;
let time: number;
const now: Now = () => new Date(time);

beforeEach(() => {
  time = Date.parse('2026-11-19T12:00:00.000Z');
  temp = createTempDb();
  boards = createBoardRepository(temp.db, now);
  accounts = createAccountRepository(temp.db);
});
afterEach(() => temp.cleanup());

function person(name: string): number {
  const users = createUserRepository(temp.db, now);
  const user = users.create({ sub: `sub-${name}`, email: `${name}@example.com` });
  users.completeProfile(user.id, { username: name, displayName: name }, null);
  return user.id;
}

/** Entra no grupo: convite e aceite, com o relógio andando (a ordem de chegada importa para a herança). */
function join(boardId: number, owner: number, member: number) {
  time += 60_000;
  expect(boards.invite(boardId, owner, member)).toBe('created');
  expect(boards.accept(boardId, member)).toBe(true);
}

const one = (sql: string, ...params: Array<string | number>) => temp.db.prepare(sql).get(...params);
const count = (sql: string, ...params: Array<string | number>) => (one(sql, ...params) as { n: number }).n;
const role = (boardId: number, userId: number) =>
  (one('SELECT role FROM board_members WHERE board_id = ? AND user_id = ?', boardId, userId) as { role: string } | undefined)?.role;

describe('deleteAccount', () => {
  it('conta que não existe: null, nada muda', () => {
    expect(accounts.deleteAccount(9999)).toBeNull();
  });

  it('o grupo passa ao membro ativo mais antigo; o grupo sem mais ninguém é apagado com as tarefas', () => {
    const ana = person('ana');
    const bia = person('bia');
    const cris = person('cris');
    const shared = boards.createGroup(ana, 'Compartilhado');
    join(shared.id, ana, bia);
    join(shared.id, ana, cris);
    const solo = boards.createGroup(ana, 'Só da Ana');
    createTaskStore(temp.db, now).forBoard(solo.id, ana).create({ title: 'Some junto' });
    const before = (one('SELECT version FROM boards WHERE id = ?', shared.id) as { version: number }).version;

    expect(accounts.deleteAccount(ana)).toEqual({ transferred: [shared.id], deleted: [solo.id] });
    expect(role(shared.id, bia)).toBe('owner');
    expect(role(shared.id, cris)).toBe('editor');
    expect((one('SELECT version FROM boards WHERE id = ?', shared.id) as { version: number }).version).toBe(before + 1);
    expect(count('SELECT COUNT(*) AS n FROM boards WHERE id = ?', solo.id)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM tasks WHERE board_id = ?', solo.id)).toBe(0);
  });

  it('na herança, conta ativa vem antes de conta desativada; convidado pendente não herda', () => {
    const ana = person('ana');
    const bia = person('bia');
    const cris = person('cris');
    const dani = person('dani');
    const group = boards.createGroup(ana, 'Equipe');
    join(group.id, ana, bia);
    join(group.id, ana, cris);
    temp.db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(bia);
    time += 60_000;
    boards.invite(group.id, ana, dani);

    accounts.deleteAccount(ana);
    expect(role(group.id, cris)).toBe('owner');
    expect(role(group.id, bia)).toBe('editor');
  });

  it('a cascata leva sessões, quadro pessoal, vínculos e convites; as tarefas em grupos ficam sem autor', () => {
    const ana = person('ana');
    const bia = person('bia');
    const cris = person('cris');
    const anaBoard = createUserRepository(temp.db, now).personalBoardId(ana) as number;
    createTaskStore(temp.db, now).forBoard(anaBoard, ana).create({ title: 'Pessoal' });
    const biasGroup = boards.createGroup(bia, 'Da Bia');
    join(biasGroup.id, bia, ana);
    const shared = createTaskStore(temp.db, now).forBoard(biasGroup.id, ana).create({ title: 'Feita pela Ana' });
    // Convite pendente que a Ana mandou (num grupo dela) e um que ela recebeu.
    const anasGroup = boards.createGroup(ana, 'Da Ana');
    join(anasGroup.id, ana, cris);
    time += 60_000;
    expect(boards.invite(anasGroup.id, ana, bia)).toBe('created');
    const crisGroup = boards.createGroup(cris, 'Da Cris');
    time += 60_000;
    expect(boards.invite(crisGroup.id, cris, ana)).toBe('created');
    createSessionRepository(temp.db, now).create(ana);
    temp.db.prepare("INSERT INTO invite_blocks (invitee_id, inviter_id, created_at) VALUES (?, ?, 'x')").run(ana, cris);

    accounts.deleteAccount(ana);
    expect(count('SELECT COUNT(*) AS n FROM users WHERE id = ?', ana)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', ana)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM boards WHERE id = ?', anaBoard)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM board_members WHERE user_id = ?', ana)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM invite_blocks')).toBe(0);
    // O convite que ela mandou (no grupo que passou para a Cris) foi cancelado.
    expect(role(anasGroup.id, bia)).toBeUndefined();
    expect(role(anasGroup.id, cris)).toBe('owner');
    expect(one('SELECT title, created_by FROM tasks WHERE id = ?', shared.id)).toEqual({ title: 'Feita pela Ana', created_by: null });
    expect(temp.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('no audit_log, a pessoa some como autora e como alvo; as linhas dos quadros ficam', () => {
    const ana = person('ana');
    const audit = createAuditRepository(temp.db, fixedNow('2026-11-19T12:00:00.000Z'));
    audit.record(ana, 'login', { kind: 'user', id: ana });
    const group = boards.createGroup(ana, 'Equipe');
    audit.record(ana, 'board.create', { kind: 'board', id: group.id });

    accounts.deleteAccount(ana);
    expect(temp.db.prepare('SELECT actor_user_id, action, target_kind, target_id FROM audit_log ORDER BY id').all()).toEqual([
      { actor_user_id: null, action: 'login', target_kind: 'user', target_id: null },
      { actor_user_id: null, action: 'board.create', target_kind: 'board', target_id: group.id },
    ]);
  });

  it('tudo ou nada: um erro no meio desfaz a transação', () => {
    const ana = person('ana');
    temp.db.exec(
      "CREATE TRIGGER falha BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT, 'falha simulada'); END",
    );
    const group = boards.createGroup(ana, 'Equipe');
    expect(() => accounts.deleteAccount(ana)).toThrow(/falha simulada/);
    expect(count('SELECT COUNT(*) AS n FROM boards WHERE id = ?', group.id)).toBe(1);
    expect(role(group.id, ana)).toBe('owner');
  });
});
