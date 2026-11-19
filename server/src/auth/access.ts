import type { MemberRole } from '@quadro/shared';
import { forbidden, notFound } from '../http/errors';
import type { BoardRepository, MembershipRecord } from '../repositories/boardRepository';

export const BOARD_NOT_FOUND = 'Quadro não encontrado';

/**
 * A única checagem de acesso a um quadro.
 * - Quem não é membro ATIVO recebe 404, o mesmo de "não existe": não dá para
 *   descobrir quais quadros existem.
 * - `minRole: 'owner'` exige o dono; um editor recebe 403 (ele já sabe que o quadro existe).
 */
export function requireMember(
  boards: BoardRepository,
  boardId: number,
  userId: number,
  minRole: MemberRole = 'editor',
): MembershipRecord {
  const membership = boards.membership(boardId, userId);
  if (!membership || membership.status !== 'active') throw notFound(BOARD_NOT_FOUND);
  if (minRole === 'owner' && membership.role !== 'owner') throw forbidden();
  return membership;
}
