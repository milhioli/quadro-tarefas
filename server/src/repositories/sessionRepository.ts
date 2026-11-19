import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Now } from '../clock';

export const SESSION_IDLE_MS = 30 * 86_400_000;
export const SESSION_MAX_MS = 90 * 86_400_000;
/** `last_seen` é renovado no máximo uma vez por hora (uma escrita por requisição seria demais). */
export const SESSION_TOUCH_MS = 60 * 60_000;

/** O banco guarda só o sha256 do token; o token em si vive no cookie. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Token de 256 bits, em base64url. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

interface SessionRow {
  user_id: number;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
}

export interface SessionRepository {
  /** Cria a sessão e devolve o token (que vai para o cookie). */
  create(userId: number): string;
  /** Usuário da sessão, ou null. A sessão expirada é apagada aqui. Renova o prazo sem uso. */
  resolve(token: string): number | null;
  delete(token: string): void;
  deleteForUser(userId: number): void;
}

export function createSessionRepository(db: DatabaseSync, now: Now): SessionRepository {
  const statements = {
    insert: db.prepare(
      'INSERT INTO sessions (id_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
    ),
    get: db.prepare('SELECT user_id, created_at, expires_at, last_seen_at FROM sessions WHERE id_hash = ?'),
    touch: db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id_hash = ?'),
    delete: db.prepare('DELETE FROM sessions WHERE id_hash = ?'),
    deleteForUser: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
  };

  return {
    create(userId) {
      const token = newSessionToken();
      const at = now().getTime();
      statements.insert.run(
        hashSessionToken(token),
        userId,
        new Date(at).toISOString(),
        new Date(at + SESSION_IDLE_MS).toISOString(),
        new Date(at).toISOString(),
      );
      return token;
    },

    resolve(token) {
      if (!TOKEN_PATTERN.test(token)) return null;
      const hash = hashSessionToken(token);
      const row = statements.get.get(hash) as unknown as SessionRow | undefined;
      if (!row) return null;
      const at = now().getTime();
      const created = Date.parse(row.created_at);
      if (at >= Date.parse(row.expires_at) || at >= created + SESSION_MAX_MS) {
        statements.delete.run(hash);
        return null;
      }
      if (at - Date.parse(row.last_seen_at) >= SESSION_TOUCH_MS) {
        const expires = Math.min(at + SESSION_IDLE_MS, created + SESSION_MAX_MS);
        statements.touch.run(new Date(at).toISOString(), new Date(expires).toISOString(), hash);
      }
      return row.user_id;
    },

    delete(token) {
      if (TOKEN_PATTERN.test(token)) statements.delete.run(hashSessionToken(token));
    },

    deleteForUser(userId) {
      statements.deleteForUser.run(userId);
    },
  };
}
