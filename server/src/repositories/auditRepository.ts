import type { DatabaseSync } from 'node:sqlite';
import { nowIso, type Now } from '../clock';

/**
 * Registro de auditoria: quem fez o quê, em que conta ou quadro. Nunca guarda
 * e-mail, handle buscado, título nem conteúdo. A leitura pelo admin é da 2b.
 */
export type AuditAction =
  | 'login'
  | 'logout'
  | 'profile.create'
  | 'board.create'
  | 'board.rename'
  | 'board.delete'
  | 'invite.create'
  | 'invite.accept'
  | 'invite.decline'
  | 'member.remove'
  | 'member.leave';

export interface AuditTarget {
  kind: 'user' | 'board';
  id: number;
}

export interface AuditRepository {
  record(actorUserId: number | null, action: AuditAction, target?: AuditTarget): void;
}

export function createAuditRepository(db: DatabaseSync, now: Now): AuditRepository {
  const insert = db.prepare('INSERT INTO audit_log (at, actor_user_id, action, target_kind, target_id) VALUES (?, ?, ?, ?, ?)');
  return {
    record(actorUserId, action, target) {
      insert.run(nowIso(now), actorUserId, action, target?.kind ?? null, target?.id ?? null);
    },
  };
}
