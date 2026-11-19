import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTempDb, type TempDb } from '../test/helpers/tempDb';
import { buildApp } from './app';
import type { Now } from './clock';
import { createAccountRepository } from './repositories/accountRepository';
import { createAuditRepository } from './repositories/auditRepository';
import { createBoardRepository } from './repositories/boardRepository';
import { createSessionRepository } from './repositories/sessionRepository';
import { createUserRepository } from './repositories/userRepository';
import { RETENTION, runRetention } from './retention';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-11-19T12:00:00.000Z');

let temp: TempDb;
let time: number;
const now: Now = () => new Date(time);

beforeEach(() => {
  time = T0;
  temp = createTempDb();
});
afterEach(() => temp.cleanup());

const deps = () => ({ accounts: createAccountRepository(temp.db), audit: createAuditRepository(temp.db, now) });
const run = () => runRetention(temp.db, now, deps());
const count = (sql: string, ...params: Array<string | number>) =>
  (temp.db.prepare(sql).get(...params) as { n: number }).n;

/** Conta com perfil (ou sem, se `profile` for false), criada no instante atual do relógio. */
function person(name: string, profile = true): number {
  const users = createUserRepository(temp.db, now);
  const user = users.create({ sub: `sub-${name}`, email: `${name}@example.com` });
  if (profile) users.completeProfile(user.id, { username: name, displayName: name }, null);
  return user.id;
}

describe('runRetention', () => {
  it('sem nada vencido, não apaga nada', () => {
    person('ana');
    expect(run()).toEqual({
      sessions: 0,
      audit: 0,
      inviteBlocks: 0,
      invites: 0,
      pendingAccounts: 0,
      disabledAccounts: 0,
      inactiveAccounts: 0,
    });
  });

  it('sessões vencidas somem; as válidas ficam', () => {
    const ana = person('ana');
    const sessions = createSessionRepository(temp.db, now);
    sessions.create(ana);
    time += 20 * DAY;
    const valid = sessions.create(ana);
    time += 10 * DAY + 1000; // a primeira passou dos 30 dias sem uso
    expect(run().sessions).toBe(1);
    expect(sessions.resolve(valid)).toBe(ana);
  });

  it('auditoria: a linha de 181 dias é apagada; a de 179 fica', () => {
    const audit = createAuditRepository(temp.db, now);
    audit.record(null, 'login');
    time += 2 * DAY;
    audit.record(null, 'logout');
    time += 179 * DAY;
    expect(run().audit).toBe(1);
    expect(temp.db.prepare('SELECT action FROM audit_log').all()).toEqual([{ action: 'logout' }]);
  });

  it('bloqueios de reconvite e convites pendentes vencem em 30 dias', () => {
    const ana = person('ana');
    const bia = person('bia');
    const cris = person('cris');
    const boards = createBoardRepository(temp.db, now);
    const group = boards.createGroup(ana, 'Equipe');
    boards.invite(group.id, ana, bia);
    boards.decline(group.id, bia); // bloqueio da Bia contra a Ana
    boards.invite(group.id, ana, cris); // convite pendente
    time += 30 * DAY - 1000;
    expect(run()).toMatchObject({ inviteBlocks: 0, invites: 0 });
    time += 2000;
    expect(run()).toMatchObject({ inviteBlocks: 1, invites: 1 });
    expect(count("SELECT COUNT(*) AS n FROM board_members WHERE status = 'invited'")).toBe(0);
  });

  it('conta sem perfil é apagada depois de 7 dias sem uso', () => {
    const pending = person('novo', false);
    person('ana');
    time += 7 * DAY + 1000;
    expect(run().pendingAccounts).toBe(1);
    expect(count('SELECT COUNT(*) AS n FROM users WHERE id = ?', pending)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM users')).toBe(1);
  });

  it('conta desativada é apagada 12 meses depois do disabled_at, passando os grupos adiante', () => {
    const ana = person('ana');
    const bia = person('bia');
    const boards = createBoardRepository(temp.db, now);
    const group = boards.createGroup(ana, 'Equipe');
    boards.invite(group.id, ana, bia);
    boards.accept(group.id, bia);
    const users = createUserRepository(temp.db, now);
    users.setStatus(ana, 'disabled');
    time += RETENTION.disabledAccountMs - 1000;
    expect(run().disabledAccounts).toBe(0);
    // A Bia continua usando o app (não é apagada por falta de uso).
    users.touch(bia);
    time += 2000;
    expect(run().disabledAccounts).toBe(1);
    expect(boards.membership(group.id, bia)).toEqual({ role: 'owner', status: 'active' });
    expect(count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'account.delete' AND actor_user_id IS NULL")).toBe(1);
  });

  it('conta sem uso há 24 meses é apagada; o admin nunca', () => {
    const users = createUserRepository(temp.db, now);
    const admin = users.create({ sub: 'sub-admin', email: 'admin@example.com' });
    users.completeProfile(admin.id, { username: 'chefe', displayName: 'Chefe' }, 'admin@example.com');
    const ana = person('ana');
    time += RETENTION.inactiveAccountMs - 1000;
    expect(run().inactiveAccounts).toBe(0);
    time += 2000;
    expect(run().inactiveAccounts).toBe(1);
    expect(count('SELECT COUNT(*) AS n FROM users WHERE id = ?', ana)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM users WHERE id = ?', admin.id)).toBe(1);
  });

  it('avisa cada conta apagada (para limpar o que está em memória)', () => {
    const pending = person('novo', false);
    time += 8 * DAY;
    const seen: number[] = [];
    runRetention(temp.db, now, { ...deps(), onAccountDeleted: (id) => seen.push(id) });
    expect(seen).toEqual([pending]);
  });
});

describe('registerRetention (buildApp com retention)', () => {
  it('roda quando o app fica pronto e loga só as contagens', async () => {
    const ana = person('ana');
    createSessionRepository(temp.db, now).create(ana);
    time += 31 * DAY;
    const logs: string[] = [];
    const app = buildApp({
      db: temp.db,
      now,
      retention: true,
      logger: { level: 'info', stream: { write: (line: string) => logs.push(line) } },
    });
    await app.ready();
    try {
      expect(count('SELECT COUNT(*) AS n FROM sessions')).toBe(0);
      const entry = logs.map((line) => JSON.parse(line) as Record<string, unknown>).find((l) => l.kind === 'retention');
      expect(entry).toMatchObject({ kind: 'retention', status: 'ok', sessions: 1 });
      expect(logs.join('\n')).not.toContain('example.com');
    } finally {
      await app.close();
    }
  });

  it('sem retention, nada roda', async () => {
    const ana = person('ana');
    createSessionRepository(temp.db, now).create(ana);
    time += 31 * DAY;
    const app = buildApp({ db: temp.db, now });
    await app.ready();
    await app.close();
    expect(count('SELECT COUNT(*) AS n FROM sessions')).toBe(1);
  });
});
