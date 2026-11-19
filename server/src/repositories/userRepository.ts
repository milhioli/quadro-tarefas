import type { DatabaseSync } from 'node:sqlite';
import { formatHandle, type AdminUser, type MeUser, type UserRole, type UserStatus } from '@quadro/shared';
import { nowIso, type Now } from '../clock';
import { withTransaction } from '../db/transaction';

/** Prefixo do `google_sub` das contas do login de desenvolvimento (só no entrypoint de E2E). */
export const DEV_SUB_PREFIX = 'dev:';
export const LEGACY_BOARD_ID = 1;
export const PERSONAL_BOARD_NAME = 'Meu quadro';
/** A tela "Contas" mostra no máximo isso (sem paginação na 2b). */
export const ADMIN_LIST_LIMIT = 500;

export interface UserRecord {
  id: number;
  googleSub: string;
  email: string;
  displayName: string | null;
  username: string | null;
  seq: number | null;
  role: UserRole;
  status: UserStatus;
  lastSeenAt: string;
  disabledAt: string | null;
}

interface UserRow {
  id: number;
  google_sub: string;
  email: string;
  display_name: string | null;
  username: string | null;
  seq: number | null;
  role: UserRole;
  status: UserStatus;
  last_seen_at: string;
  disabled_at: string | null;
}

function toRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    googleSub: row.google_sub,
    email: row.email,
    displayName: row.display_name,
    username: row.username,
    seq: row.seq,
    role: row.role,
    status: row.status,
    lastSeenAt: row.last_seen_at,
    disabledAt: row.disabled_at,
  };
}

export function isDevUser(user: Pick<UserRecord, 'googleSub'>): boolean {
  return user.googleSub.startsWith(DEV_SUB_PREFIX);
}

export function hasProfile(user: UserRecord): user is UserRecord & { username: string; seq: number; displayName: string } {
  return user.username !== null && user.seq !== null && user.displayName !== null;
}

export class ProfileExistsError extends Error {
  constructor() {
    super('O perfil desta conta já foi criado');
    this.name = 'ProfileExistsError';
  }
}

export interface UserRepository {
  findBySub(sub: string): UserRecord | null;
  get(id: number): UserRecord | null;
  /** Cria a conta sem perfil (primeiro login). O usuário é achado sempre pelo `sub`, nunca pelo e-mail. */
  create(input: { sub: string; email: string }): UserRecord;
  /**
   * Cria o perfil (nome de usuário e de exibição) e o quadro pessoal, numa transação.
   * - `seq 0` e admin: só se o e-mail for o `adminEmail` e ninguém tiver o seq 0 ainda.
   *   Gravado uma vez; nada é recalculado pelo e-mail depois.
   * - O admin reclama o quadro legado (1) se ainda não tiver dono.
   * - Os demais recebem o próximo número de um contador que nunca desce.
   */
  completeProfile(id: number, profile: { username: string; displayName: string }, adminEmail: string | null): UserRecord;
  /** Quadro pessoal do usuário. */
  personalBoardId(id: number): number | null;
  findByHandle(username: string, seq: number): UserRecord | null;
  touch(id: number): void;
  /** Tela "Contas" do admin: só handle, e-mail, status e último acesso (R10). */
  listForAdmin(): AdminUser[];
  /**
   * Ativa ou desativa a conta. Desativar grava o `disabled_at` (a retenção
   * apaga a conta depois de 12 meses) e apaga todas as sessões na hora.
   * false se nada mudou.
   */
  setStatus(id: number, status: UserStatus): boolean;
  /** Quantos usuários existem que não são do login de desenvolvimento. */
  countNonDev(): number;
  toMe(user: UserRecord): MeUser | null;
}

export function createUserRepository(db: DatabaseSync, now: Now): UserRepository {
  const statements = {
    bySub: db.prepare('SELECT * FROM users WHERE google_sub = ?'),
    byId: db.prepare('SELECT * FROM users WHERE id = ?'),
    byHandle: db.prepare('SELECT * FROM users WHERE username = ? AND seq = ?'),
    insert: db.prepare(
      'INSERT INTO users (google_sub, email, created_at, last_seen_at) VALUES (?, ?, ?, ?)',
    ),
    hasSeqZero: db.prepare('SELECT 1 FROM users WHERE seq = 0'),
    nextSeq: db.prepare("UPDATE counters SET value = value + 1 WHERE name = 'next_user_seq' RETURNING value - 1 AS seq"),
    setProfile: db.prepare('UPDATE users SET username = ?, display_name = ?, seq = ?, role = ? WHERE id = ?'),
    claimLegacy: db.prepare(
      "UPDATE boards SET owner_user_id = ? WHERE id = ? AND kind = 'personal' AND owner_user_id IS NULL",
    ),
    createPersonal: db.prepare("INSERT INTO boards (name, kind, owner_user_id, created_at) VALUES (?, 'personal', ?, ?)"),
    addOwner: db.prepare(
      "INSERT INTO board_members (board_id, user_id, role, status, invited_by, created_at) VALUES (?, ?, 'owner', 'active', NULL, ?)",
    ),
    personal: db.prepare("SELECT id FROM boards WHERE owner_user_id = ? AND kind = 'personal'"),
    touch: db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?'),
    listForAdmin: db.prepare(
      'SELECT id, email, username, seq, status, last_seen_at FROM users ORDER BY last_seen_at DESC, id LIMIT ?',
    ),
    setStatus: db.prepare(
      `UPDATE users SET status = ?, disabled_at = CASE WHEN ? = 'disabled' THEN ? ELSE NULL END
       WHERE id = ? AND status <> ?`,
    ),
    deleteSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    countNonDev: db.prepare("SELECT COUNT(*) AS n FROM users WHERE google_sub NOT LIKE 'dev:%'"),
  };

  function get(id: number): UserRecord | null {
    const row = statements.byId.get(id) as unknown as UserRow | undefined;
    return row ? toRecord(row) : null;
  }

  function personalBoardId(id: number): number | null {
    const row = statements.personal.get(id) as { id: number } | undefined;
    return row ? row.id : null;
  }

  return {
    findBySub(sub) {
      const row = statements.bySub.get(sub) as unknown as UserRow | undefined;
      return row ? toRecord(row) : null;
    },

    get,

    create({ sub, email }) {
      const timestamp = nowIso(now);
      const id = Number(statements.insert.run(sub, email.toLowerCase(), timestamp, timestamp).lastInsertRowid);
      return get(id) as UserRecord;
    },

    completeProfile(id, profile, adminEmail) {
      return withTransaction(db, () => {
        const user = get(id);
        if (!user) throw new Error('Usuário não encontrado');
        if (hasProfile(user)) throw new ProfileExistsError();
        const timestamp = nowIso(now);

        const isAdmin =
          adminEmail !== null && user.email === adminEmail && statements.hasSeqZero.get() === undefined;
        const seq = isAdmin ? 0 : (statements.nextSeq.get() as { seq: number }).seq;
        statements.setProfile.run(profile.username, profile.displayName, seq, isAdmin ? 'admin' : 'user', id);

        let boardId: number;
        if (isAdmin && Number(statements.claimLegacy.run(id, LEGACY_BOARD_ID).changes) === 1) {
          boardId = LEGACY_BOARD_ID;
        } else {
          boardId = Number(statements.createPersonal.run(PERSONAL_BOARD_NAME, id, timestamp).lastInsertRowid);
        }
        statements.addOwner.run(boardId, id, timestamp);
        return get(id) as UserRecord;
      });
    },

    personalBoardId,

    findByHandle(username, seq) {
      const row = statements.byHandle.get(username, seq) as unknown as UserRow | undefined;
      return row ? toRecord(row) : null;
    },

    touch(id) {
      statements.touch.run(nowIso(now), id);
    },

    listForAdmin() {
      const rows = statements.listForAdmin.all(ADMIN_LIST_LIMIT) as Array<{
        id: number;
        email: string;
        username: string | null;
        seq: number | null;
        status: UserStatus;
        last_seen_at: string;
      }>;
      return rows.map((row) => ({
        id: row.id,
        handle: row.username !== null && row.seq !== null ? formatHandle(row.username, row.seq) : null,
        email: row.email,
        status: row.status,
        lastSeenAt: row.last_seen_at,
      }));
    },

    setStatus(id, status) {
      return withTransaction(db, () => {
        const changed = Number(statements.setStatus.run(status, status, nowIso(now), id, status).changes) > 0;
        if (changed && status === 'disabled') statements.deleteSessions.run(id);
        return changed;
      });
    },

    countNonDev() {
      return (statements.countNonDev.get() as { n: number }).n;
    },

    toMe(user) {
      if (!hasProfile(user)) return null;
      const boardId = personalBoardId(user.id);
      if (boardId === null) return null;
      return {
        id: user.id,
        handle: formatHandle(user.username, user.seq),
        displayName: user.displayName,
        role: user.role,
        personalBoardId: boardId,
      };
    },
  };
}
