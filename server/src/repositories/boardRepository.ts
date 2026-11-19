import type { DatabaseSync } from 'node:sqlite';
import {
  formatHandle,
  type BoardKind,
  type BoardSummary,
  type Invite,
  type Member,
  type MemberRole,
  type MemberStatus,
} from '@quadro/shared';
import { nowIso, type Now } from '../clock';
import { withTransaction } from '../db/transaction';
import { LimitReachedError } from '../http/errors';

/**
 * Quadros e membros. O acesso vem SÓ de board_members (inclusive o owner do
 * quadro pessoal): quem não é membro ativo não enxerga nada do quadro.
 */
export interface BoardRecord {
  id: number;
  name: string;
  kind: BoardKind;
}

export interface MembershipRecord {
  role: MemberRole;
  status: MemberStatus;
}

/** Tetos de grupos e convites (Fase 2b). Ficam no banco: valem mesmo depois de reiniciar. */
export const MAX_GROUPS_PER_OWNER = 20;
export const MAX_MEMBERS_PER_GROUP = 50;
export const MAX_PENDING_INVITES_PER_GROUP = 20;
/** Quem recusou um convite (ou saiu do grupo) não recebe outro da mesma pessoa por 30 dias. */
export const INVITE_BLOCK_MS = 30 * 24 * 60 * 60 * 1000;

export type InviteOutcome =
  | 'created'
  | 'already-member'
  /** Recusou (ou saiu) há menos de 30 dias. */
  | 'blocked'
  /** Já existe um convite pendente de quem convida para essa pessoa, em qualquer grupo. */
  | 'pending-pair'
  | 'board-full'
  | 'too-many-pending';

export interface BoardRepository {
  get(boardId: number): BoardRecord | null;
  /** Quadros em que a pessoa é membro ativo: o pessoal primeiro, depois os grupos por nome. */
  listForUser(userId: number): BoardSummary[];
  membership(boardId: number, userId: number): MembershipRecord | null;
  /** Quadro da tarefa, só se a pessoa for membro ativo dele (uma consulta só decide existência e acesso). */
  taskBoardForMember(taskId: number, userId: number): number | null;
  createGroup(ownerId: number, name: string): BoardSummary;
  rename(boardId: number, name: string): void;
  delete(boardId: number): void;
  /** Membros ativos e convidados, com o handle e o nome de exibição. */
  members(boardId: number): Member[];
  invite(boardId: number, inviterId: number, inviteeId: number): InviteOutcome;
  invitesFor(userId: number): Invite[];
  /** Aceita o convite pendente; false se não havia. */
  accept(boardId: number, userId: number): boolean;
  /**
   * Recusa (apaga) o convite pendente; false se não havia. Bloqueia quem
   * convidou por 30 dias e apaga os outros convites pendentes dessa pessoa.
   */
  decline(boardId: number, userId: number): boolean;
  /** A pessoa sai do grupo: bloqueia o dono atual por 30 dias. false se ela não estava. */
  leave(boardId: number, userId: number): boolean;
  /** Tira a pessoa do quadro (membro ativo ou convite pendente), sem bloqueio; false se ela não estava. */
  removeMember(boardId: number, userId: number): boolean;
}

interface MemberRow {
  user_id: number;
  username: string;
  seq: number;
  display_name: string;
  role: MemberRole;
  status: MemberStatus;
}

interface InviteRow {
  board_id: number;
  board_name: string;
  inviter_username: string | null;
  inviter_seq: number | null;
}

export function createBoardRepository(db: DatabaseSync, now: Now): BoardRepository {
  const statements = {
    get: db.prepare('SELECT id, name, kind FROM boards WHERE id = ?'),
    listForUser: db.prepare(
      `SELECT b.id, b.name, b.kind, m.role FROM boards b
       JOIN board_members m ON m.board_id = b.id
       WHERE m.user_id = ? AND m.status = 'active'
       ORDER BY (b.kind = 'group'), b.name COLLATE NOCASE, b.id`,
    ),
    membership: db.prepare('SELECT role, status FROM board_members WHERE board_id = ? AND user_id = ?'),
    taskBoardForMember: db.prepare(
      `SELECT t.board_id FROM tasks t
       JOIN board_members m ON m.board_id = t.board_id AND m.user_id = ? AND m.status = 'active'
       WHERE t.id = ?`,
    ),
    insertGroup: db.prepare("INSERT INTO boards (name, kind, owner_user_id, created_at) VALUES (?, 'group', NULL, ?)"),
    insertMember: db.prepare(
      'INSERT INTO board_members (board_id, user_id, role, status, invited_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ),
    rename: db.prepare('UPDATE boards SET name = ?, version = version + 1 WHERE id = ?'),
    delete: db.prepare('DELETE FROM boards WHERE id = ?'),
    members: db.prepare(
      `SELECT m.user_id, u.username, u.seq, u.display_name, m.role, m.status
       FROM board_members m JOIN users u ON u.id = m.user_id
       WHERE m.board_id = ? AND u.username IS NOT NULL
       ORDER BY (m.role <> 'owner'), (m.status <> 'active'), u.display_name COLLATE NOCASE, u.id`,
    ),
    invitesFor: db.prepare(
      `SELECT b.id AS board_id, b.name AS board_name, inv.username AS inviter_username, inv.seq AS inviter_seq
       FROM board_members m
       JOIN boards b ON b.id = m.board_id
       LEFT JOIN users inv ON inv.id = m.invited_by
       WHERE m.user_id = ? AND m.status = 'invited'
       ORDER BY m.created_at, b.id`,
    ),
    accept: db.prepare("UPDATE board_members SET status = 'active' WHERE board_id = ? AND user_id = ? AND status = 'invited'"),
    decline: db.prepare("DELETE FROM board_members WHERE board_id = ? AND user_id = ? AND status = 'invited'"),
    remove: db.prepare('DELETE FROM board_members WHERE board_id = ? AND user_id = ?'),
    bump: db.prepare('UPDATE boards SET version = version + 1 WHERE id = ?'),
    groupsOwned: db.prepare(
      `SELECT COUNT(*) AS n FROM board_members m JOIN boards b ON b.id = m.board_id
       WHERE m.user_id = ? AND m.role = 'owner' AND b.kind = 'group'`,
    ),
    memberCounts: db.prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(status = 'invited'), 0) AS pending FROM board_members WHERE board_id = ?`,
    ),
    blocked: db.prepare('SELECT 1 FROM invite_blocks WHERE invitee_id = ? AND inviter_id = ? AND created_at > ?'),
    pendingPair: db.prepare("SELECT 1 FROM board_members WHERE user_id = ? AND invited_by = ? AND status = 'invited' LIMIT 1"),
    invitedBy: db.prepare("SELECT invited_by FROM board_members WHERE board_id = ? AND user_id = ? AND status = 'invited'"),
    deletePendingFrom: db.prepare("DELETE FROM board_members WHERE user_id = ? AND invited_by = ? AND status = 'invited'"),
    ownerOf: db.prepare("SELECT user_id FROM board_members WHERE board_id = ? AND role = 'owner'"),
    block: db.prepare(
      `INSERT INTO invite_blocks (invitee_id, inviter_id, created_at) VALUES (?, ?, ?)
       ON CONFLICT (invitee_id, inviter_id) DO UPDATE SET created_at = excluded.created_at`,
    ),
  };

  function blockInviter(inviteeId: number, inviterId: number | null, timestamp: string): void {
    if (inviterId !== null && inviterId !== inviteeId) statements.block.run(inviteeId, inviterId, timestamp);
  }

  return {
    get(boardId) {
      return (statements.get.get(boardId) as unknown as BoardRecord | undefined) ?? null;
    },

    listForUser(userId) {
      return statements.listForUser.all(userId) as unknown as BoardSummary[];
    },

    membership(boardId, userId) {
      return (statements.membership.get(boardId, userId) as unknown as MembershipRecord | undefined) ?? null;
    },

    taskBoardForMember(taskId, userId) {
      const row = statements.taskBoardForMember.get(userId, taskId) as { board_id: number } | undefined;
      return row ? row.board_id : null;
    },

    createGroup(ownerId, name) {
      return withTransaction(db, () => {
        const { n } = statements.groupsOwned.get(ownerId) as { n: number };
        if (n >= MAX_GROUPS_PER_OWNER) {
          throw new LimitReachedError(
            `Você chegou ao limite de ${MAX_GROUPS_PER_OWNER} grupos. Apague um grupo para criar outro.`,
          );
        }
        const timestamp = nowIso(now);
        const id = Number(statements.insertGroup.run(name, timestamp).lastInsertRowid);
        statements.insertMember.run(id, ownerId, 'owner', 'active', null, timestamp);
        return { id, name, kind: 'group', role: 'owner' };
      });
    },

    rename(boardId, name) {
      statements.rename.run(name, boardId);
    },

    delete(boardId) {
      statements.delete.run(boardId);
    },

    members(boardId) {
      return (statements.members.all(boardId) as unknown as MemberRow[]).map((row) => ({
        userId: row.user_id,
        handle: formatHandle(row.username, row.seq),
        displayName: row.display_name,
        role: row.role,
        status: row.status,
      }));
    },

    invite(boardId, inviterId, inviteeId) {
      return withTransaction(db, () => {
        if (statements.membership.get(boardId, inviteeId)) return 'already-member';
        const since = new Date(now().getTime() - INVITE_BLOCK_MS).toISOString();
        if (statements.blocked.get(inviteeId, inviterId, since)) return 'blocked';
        if (statements.pendingPair.get(inviteeId, inviterId)) return 'pending-pair';
        const counts = statements.memberCounts.get(boardId) as { total: number; pending: number };
        if (counts.total >= MAX_MEMBERS_PER_GROUP) return 'board-full';
        if (counts.pending >= MAX_PENDING_INVITES_PER_GROUP) return 'too-many-pending';
        statements.insertMember.run(boardId, inviteeId, 'editor', 'invited', inviterId, nowIso(now));
        return 'created';
      });
    },

    invitesFor(userId) {
      return (statements.invitesFor.all(userId) as unknown as InviteRow[]).map((row) => ({
        boardId: row.board_id,
        boardName: row.board_name,
        invitedBy:
          row.inviter_username !== null && row.inviter_seq !== null ? formatHandle(row.inviter_username, row.inviter_seq) : null,
      }));
    },

    accept(boardId, userId) {
      return withTransaction(db, () => {
        const changed = Number(statements.accept.run(boardId, userId).changes) > 0;
        if (changed) statements.bump.run(boardId);
        return changed;
      });
    },

    decline(boardId, userId) {
      return withTransaction(db, () => {
        const row = statements.invitedBy.get(boardId, userId) as { invited_by: number | null } | undefined;
        if (!row) return false;
        statements.decline.run(boardId, userId);
        if (row.invited_by !== null) {
          blockInviter(userId, row.invited_by, nowIso(now));
          statements.deletePendingFrom.run(userId, row.invited_by);
        }
        return true;
      });
    },

    leave(boardId, userId) {
      return withTransaction(db, () => {
        const owner = statements.ownerOf.get(boardId) as { user_id: number } | undefined;
        const changed = Number(statements.remove.run(boardId, userId).changes) > 0;
        if (!changed) return false;
        statements.bump.run(boardId);
        blockInviter(userId, owner?.user_id ?? null, nowIso(now));
        return true;
      });
    },

    removeMember(boardId, userId) {
      return withTransaction(db, () => {
        const changed = Number(statements.remove.run(boardId, userId).changes) > 0;
        if (changed) statements.bump.run(boardId);
        return changed;
      });
    },
  };
}
