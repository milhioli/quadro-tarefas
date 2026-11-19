import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTempDb, type TempDb } from '../../test/helpers/tempDb';
import { fixedNow } from '../clock';
import { ProfileExistsError, createUserRepository, hasProfile, isDevUser, type UserRepository } from './userRepository';

let temp: TempDb;
let users: UserRepository;
const ADMIN = 'admin@example.com';

beforeEach(() => {
  temp = createTempDb();
  users = createUserRepository(temp.db, fixedNow('2026-11-18T12:00:00.000Z'));
});
afterEach(() => temp.cleanup());

const members = (boardId: number) =>
  temp.db.prepare('SELECT user_id, role, status FROM board_members WHERE board_id = ? ORDER BY user_id').all(boardId);

describe('userRepository', () => {
  it('cria a conta sem perfil, achada pelo sub, com o e-mail em minúsculas', () => {
    const user = users.create({ sub: 'google-1', email: 'Ana@Example.com' });
    expect(user).toMatchObject({ googleSub: 'google-1', email: 'ana@example.com', username: null, seq: null, role: 'user', status: 'active' });
    expect(hasProfile(user)).toBe(false);
    expect(users.findBySub('google-1')?.id).toBe(user.id);
    expect(users.findBySub('ana@example.com')).toBeNull();
    expect(users.toMe(user)).toBeNull();
  });

  it('o admin recebe seq 0 e reclama o quadro legado (1), mesmo entrando depois de outros', () => {
    const ana = users.create({ sub: 'g-ana', email: 'ana@example.com' });
    const anaDone = users.completeProfile(ana.id, { username: 'ana', displayName: 'Ana' }, ADMIN);
    expect(anaDone).toMatchObject({ seq: 1, role: 'user' });
    expect(users.personalBoardId(ana.id)).not.toBe(1);

    const admin = users.create({ sub: 'g-admin', email: ADMIN });
    const adminDone = users.completeProfile(admin.id, { username: 'chefe', displayName: 'Chefe' }, ADMIN);
    expect(adminDone).toMatchObject({ seq: 0, role: 'admin' });
    expect(users.personalBoardId(admin.id)).toBe(1);
    expect(members(1)).toEqual([{ user_id: admin.id, role: 'owner', status: 'active' }]);
    expect(users.toMe(adminDone)).toEqual({ id: admin.id, handle: 'chefe_00', displayName: 'Chefe', role: 'admin', personalBoardId: 1 });
  });

  it('um segundo sub com o e-mail do admin vira usuário comum e não toca no quadro legado', () => {
    const admin = users.create({ sub: 'g-admin', email: ADMIN });
    users.completeProfile(admin.id, { username: 'chefe', displayName: 'Chefe' }, ADMIN);
    const impostor = users.create({ sub: 'g-outro', email: ADMIN });
    const done = users.completeProfile(impostor.id, { username: 'chefe2', displayName: 'Outro' }, ADMIN);
    expect(done).toMatchObject({ role: 'user', seq: 1 });
    expect(users.personalBoardId(impostor.id)).not.toBe(1);
    expect(members(1)).toEqual([{ user_id: admin.id, role: 'owner', status: 'active' }]);
  });

  it('sem e-mail de admin configurado, ninguém vira admin e o quadro legado fica sem dono', () => {
    const ana = users.create({ sub: 'g-ana', email: ADMIN });
    expect(users.completeProfile(ana.id, { username: 'ana', displayName: 'Ana' }, null)).toMatchObject({ role: 'user', seq: 1 });
    expect(temp.db.prepare('SELECT owner_user_id FROM boards WHERE id = 1').get()).toEqual({ owner_user_id: null });
  });

  it('o contador nunca desce: um número não volta depois de a conta sumir', () => {
    const a = users.create({ sub: 'a', email: 'a@example.com' });
    users.completeProfile(a.id, { username: 'aaa', displayName: 'A' }, null);
    temp.db.prepare('DELETE FROM users WHERE id = ?').run(a.id);
    const b = users.create({ sub: 'b', email: 'b@example.com' });
    expect(users.completeProfile(b.id, { username: 'bbb', displayName: 'B' }, null).seq).toBe(2);
  });

  it('o mesmo nome de usuário pode existir com números diferentes; o handle é único', () => {
    const a = users.completeProfile(users.create({ sub: 'a', email: 'a@example.com' }).id, { username: 'ana', displayName: 'A' }, null);
    const b = users.completeProfile(users.create({ sub: 'b', email: 'b@example.com' }).id, { username: 'ana', displayName: 'B' }, null);
    expect([users.toMe(a)?.handle, users.toMe(b)?.handle]).toEqual(['ana_01', 'ana_02']);
    expect(users.findByHandle('ana', 2)?.id).toBe(b.id);
    expect(users.findByHandle('ana', 3)).toBeNull();
  });

  it('criar o perfil duas vezes é recusado', () => {
    const a = users.create({ sub: 'a', email: 'a@example.com' });
    users.completeProfile(a.id, { username: 'ana', displayName: 'A' }, null);
    expect(() => users.completeProfile(a.id, { username: 'outra', displayName: 'X' }, null)).toThrow(ProfileExistsError);
  });

  it('isDevUser e countNonDev distinguem as contas do login de desenvolvimento', () => {
    const dev = users.create({ sub: 'dev:a@example.com', email: 'a@example.com' });
    expect(isDevUser(dev)).toBe(true);
    expect(users.countNonDev()).toBe(0);
    users.create({ sub: '1234567890', email: 'b@gmail.com' });
    expect(users.countNonDev()).toBe(1);
  });
});
