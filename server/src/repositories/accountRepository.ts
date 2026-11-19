import type { DatabaseSync } from 'node:sqlite';
import { withTransaction } from '../db/transaction';
import type { AuditRepository } from './auditRepository';

/**
 * Apagar uma conta (Fase 2b, R9): pela própria pessoa (`DELETE /api/me`), pelo
 * admin (conta desativada) ou pela retenção. Tudo numa transação só, com SQL
 * próprio, porque `withTransaction` não é reentrante.
 *
 * - Cada grupo de que a pessoa é dona passa ao membro ativo mais antigo (de
 *   preferência com a conta ativa). Sem ninguém, o grupo é apagado com as tarefas.
 * - Os convites pendentes que ela mandou são cancelados.
 * - A cascata leva as sessões, o quadro pessoal (e as tarefas), os vínculos,
 *   os convites recebidos e os bloqueios de reconvite.
 * - As tarefas que ela criou em grupos ficam, sem autor (created_by → NULL).
 * - No audit_log, ela some como autora (FK SET NULL) e como alvo (aqui).
 */
export interface DeletedAccount {
  /** Grupos que passaram para outra pessoa. */
  transferred: number[];
  /** Grupos apagados por não ter mais ninguém. */
  deleted: number[];
}

export interface AccountRepository {
  /** null se a conta não existe. */
  deleteAccount(userId: number): DeletedAccount | null;
}

/** Auditoria de uma conta apagada (depois do commit): o destino dos grupos e a exclusão, sem a pessoa. */
export function auditDeletedAccount(audit: AuditRepository, actorId: number | null, result: DeletedAccount): void {
  for (const id of result.transferred) audit.record(actorId, 'board.transfer', { kind: 'board', id });
  for (const id of result.deleted) audit.record(actorId, 'board.delete', { kind: 'board', id });
  audit.record(actorId, 'account.delete');
}

export function createAccountRepository(db: DatabaseSync): AccountRepository {
  const statements = {
    exists: db.prepare('SELECT 1 FROM users WHERE id = ?'),
    ownedGroups: db.prepare(
      `SELECT m.board_id FROM board_members m JOIN boards b ON b.id = m.board_id
       WHERE m.user_id = ? AND m.role = 'owner' AND b.kind = 'group' ORDER BY m.board_id`,
    ),
    heir: db.prepare(
      `SELECT m.user_id FROM board_members m JOIN users u ON u.id = m.user_id
       WHERE m.board_id = ? AND m.user_id <> ? AND m.status = 'active'
       ORDER BY (u.status <> 'active'), m.created_at, m.user_id
       LIMIT 1`,
    ),
    deleteOwnerRow: db.prepare("DELETE FROM board_members WHERE board_id = ? AND user_id = ? AND role = 'owner'"),
    promote: db.prepare("UPDATE board_members SET role = 'owner' WHERE board_id = ? AND user_id = ?"),
    bump: db.prepare('UPDATE boards SET version = version + 1 WHERE id = ?'),
    deleteBoard: db.prepare('DELETE FROM boards WHERE id = ?'),
    cancelSentInvites: db.prepare("DELETE FROM board_members WHERE invited_by = ? AND status = 'invited'"),
    bumpEditorBoards: db.prepare(
      `UPDATE boards SET version = version + 1
       WHERE id IN (SELECT board_id FROM board_members WHERE user_id = ? AND status = 'active' AND role = 'editor')`,
    ),
    clearAuditTarget: db.prepare("UPDATE audit_log SET target_id = NULL WHERE target_kind = 'user' AND target_id = ?"),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
  };

  return {
    deleteAccount(userId) {
      return withTransaction(db, () => {
        if (!statements.exists.get(userId)) return null;
        const transferred: number[] = [];
        const deleted: number[] = [];
        for (const { board_id: boardId } of statements.ownedGroups.all(userId) as Array<{ board_id: number }>) {
          const heir = statements.heir.get(boardId, userId) as { user_id: number } | undefined;
          if (heir) {
            // Nesta ordem: o índice permite um dono só por quadro.
            statements.deleteOwnerRow.run(boardId, userId);
            statements.promote.run(boardId, heir.user_id);
            statements.bump.run(boardId);
            transferred.push(boardId);
          } else {
            statements.deleteBoard.run(boardId);
            deleted.push(boardId);
          }
        }
        statements.cancelSentInvites.run(userId);
        statements.bumpEditorBoards.run(userId);
        statements.clearAuditTarget.run(userId);
        statements.deleteUser.run(userId);
        return { transferred, deleted };
      });
    },
  };
}
