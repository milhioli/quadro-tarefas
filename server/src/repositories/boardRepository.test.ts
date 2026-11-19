import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTempDb, type TempDb } from '../../test/helpers/tempDb';
import { fixedNow } from '../clock';
import { createBoardRepository, type BoardRepository } from './boardRepository';
import { createTaskStore } from './taskRepository';
import { createUserRepository } from './userRepository';

let temp: TempDb;
let boards: BoardRepository;
const now = fixedNow('2026-11-18T12:00:00.000Z');

beforeEach(() => {
  temp = createTempDb();
  boards = createBoardRepository(temp.db, now);
});
afterEach(() => temp.cleanup());

function person(name: string): number {
  const users = createUserRepository(temp.db, now);
  const user = users.create({ sub: `sub-${name}`, email: `${name}@example.com` });
  users.completeProfile(user.id, { username: name, displayName: name.toUpperCase() }, null);
  return user.id;
}

const version = (boardId: number) =>
  (temp.db.prepare('SELECT version FROM boards WHERE id = ?').get(boardId) as { version: number }).version;

describe('boardRepository', () => {
  it('criar grupo põe o dono como membro ativo', () => {
    const ana = person('ana');
    const group = boards.createGroup(ana, 'Equipe');
    expect(group).toMatchObject({ name: 'Equipe', kind: 'group', role: 'owner' });
    expect(boards.membership(group.id, ana)).toEqual({ role: 'owner', status: 'active' });
    expect(boards.listForUser(ana).map((b) => b.kind)).toEqual(['personal', 'group']);
  });

  it('convite: pendente não lista o quadro; aceito lista; recusa apaga', () => {
    const ana = person('ana');
    const bia = person('bia');
    const group = boards.createGroup(ana, 'Equipe');
    expect(boards.invite(group.id, ana, bia)).toBe('created');
    expect(boards.invite(group.id, ana, bia)).toBe('already-member');
    expect(boards.listForUser(bia).map((b) => b.id)).not.toContain(group.id);
    expect(boards.invitesFor(bia)).toEqual([{ boardId: group.id, boardName: 'Equipe', invitedBy: 'ana_01' }]);

    const before = version(group.id);
    expect(boards.accept(group.id, bia)).toBe(true);
    expect(version(group.id)).toBe(before + 1);
    expect(boards.accept(group.id, bia)).toBe(false);
    expect(boards.listForUser(bia).map((b) => b.id)).toContain(group.id);
    expect(boards.decline(group.id, bia)).toBe(false);
  });

  it('taskBoardForMember: só membro ativo acha o quadro da tarefa', () => {
    const ana = person('ana');
    const bia = person('bia');
    const group = boards.createGroup(ana, 'Equipe');
    const task = createTaskStore(temp.db, now).forBoard(group.id, ana).create({ title: 'T' });
    expect(boards.taskBoardForMember(task.id, ana)).toBe(group.id);
    expect(boards.taskBoardForMember(task.id, bia)).toBeNull();
    boards.invite(group.id, ana, bia);
    expect(boards.taskBoardForMember(task.id, bia)).toBeNull();
    boards.accept(group.id, bia);
    expect(boards.taskBoardForMember(task.id, bia)).toBe(group.id);
    boards.removeMember(group.id, bia);
    expect(boards.taskBoardForMember(task.id, bia)).toBeNull();
    expect(boards.taskBoardForMember(99999, ana)).toBeNull();
  });

  it('membros listam handle e nome de exibição, nunca o e-mail; o convite mostra quem convidou mesmo se a conta sumir', () => {
    const ana = person('ana');
    const bia = person('bia');
    const group = boards.createGroup(ana, 'Equipe');
    boards.invite(group.id, ana, bia);
    expect(boards.members(group.id)).toEqual([
      { userId: ana, handle: 'ana_01', displayName: 'ANA', role: 'owner', status: 'active' },
      { userId: bia, handle: 'bia_02', displayName: 'BIA', role: 'editor', status: 'invited' },
    ]);
    temp.db.prepare('DELETE FROM users WHERE id = ?').run(ana);
    expect(boards.invitesFor(bia)).toEqual([{ boardId: group.id, boardName: 'Equipe', invitedBy: null }]);
  });

  it('apagar o grupo apaga membros e tarefas', () => {
    const ana = person('ana');
    const group = boards.createGroup(ana, 'Equipe');
    createTaskStore(temp.db, now).forBoard(group.id, ana).create({ title: 'T' });
    boards.delete(group.id);
    expect(boards.get(group.id)).toBeNull();
    expect(temp.db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE board_id = ?').get(group.id)).toEqual({ n: 0 });
    expect(boards.membership(group.id, ana)).toBeNull();
  });
});
