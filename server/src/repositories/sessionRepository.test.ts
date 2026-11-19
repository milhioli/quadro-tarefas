import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTempDb, type TempDb } from '../../test/helpers/tempDb';
import type { Now } from '../clock';
import {
  SESSION_IDLE_MS,
  SESSION_MAX_MS,
  SESSION_TOUCH_MS,
  createSessionRepository,
  hashSessionToken,
  newSessionToken,
} from './sessionRepository';
import { createUserRepository } from './userRepository';

let temp: TempDb;
let time = Date.parse('2026-11-18T12:00:00.000Z');
const now: Now = () => new Date(time);

beforeEach(() => {
  temp = createTempDb();
  time = Date.parse('2026-11-18T12:00:00.000Z');
});
afterEach(() => temp.cleanup());

function newUser(): number {
  return createUserRepository(temp.db, now).create({ sub: `s${Math.random()}`, email: 'a@example.com' }).id;
}

describe('sessionRepository', () => {
  it('o token tem 256 bits e o banco guarda só o sha256 dele', () => {
    const sessions = createSessionRepository(temp.db, now);
    const userId = newUser();
    const token = sessions.create(userId);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newSessionToken()).not.toBe(newSessionToken());
    const rows = temp.db.prepare('SELECT id_hash FROM sessions').all() as Array<{ id_hash: string }>;
    expect(rows).toEqual([{ id_hash: hashSessionToken(token) }]);
    expect(rows[0]?.id_hash).not.toContain(token);
    expect(sessions.resolve(token)).toBe(userId);
  });

  it('token desconhecido ou malformado não resolve', () => {
    const sessions = createSessionRepository(temp.db, now);
    expect(sessions.resolve(newSessionToken())).toBeNull();
    expect(sessions.resolve('curto')).toBeNull();
    expect(sessions.resolve("' OR 1=1 --")).toBeNull();
  });

  it('expira com 30 dias sem uso e apaga a linha', () => {
    const sessions = createSessionRepository(temp.db, now);
    const token = sessions.create(newUser());
    time += SESSION_IDLE_MS;
    expect(sessions.resolve(token)).toBeNull();
    expect(temp.db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
  });

  it('o uso renova o prazo (no máximo uma escrita por hora), até o teto de 90 dias', () => {
    const sessions = createSessionRepository(temp.db, now);
    const userId = newUser();
    const token = sessions.create(userId);
    const expires = () => (temp.db.prepare('SELECT expires_at FROM sessions').get() as { expires_at: string }).expires_at;
    const first = expires();
    time += SESSION_TOUCH_MS / 2;
    sessions.resolve(token);
    expect(expires()).toBe(first);
    time += SESSION_TOUCH_MS;
    sessions.resolve(token);
    expect(expires()).not.toBe(first);
    // Usando sempre, ainda assim acaba em 90 dias.
    for (let day = 1; day < 90; day += 20) {
      time = Date.parse('2026-11-18T12:00:00.000Z') + day * 86_400_000;
      expect(sessions.resolve(token)).toBe(userId);
    }
    time = Date.parse('2026-11-18T12:00:00.000Z') + SESSION_MAX_MS;
    expect(sessions.resolve(token)).toBeNull();
  });

  it('apagar uma sessão ou todas as de uma conta', () => {
    const sessions = createSessionRepository(temp.db, now);
    const userId = newUser();
    const a = sessions.create(userId);
    const b = sessions.create(userId);
    sessions.delete(a);
    expect(sessions.resolve(a)).toBeNull();
    expect(sessions.resolve(b)).toBe(userId);
    sessions.deleteForUser(userId);
    expect(sessions.resolve(b)).toBeNull();
  });
});
