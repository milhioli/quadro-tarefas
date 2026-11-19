import { boardIdParamsSchema, type BoardSummary, type InviteListResponse } from '@quadro/shared';
import type { FastifyInstance } from 'fastify';
import { notFound } from '../http/errors';
import { validate } from '../http/validate';
import type { AuditRepository } from '../repositories/auditRepository';
import type { BoardRepository } from '../repositories/boardRepository';
import type { UserRecord } from '../repositories/userRepository';

export interface InviteRouteDeps {
  boards: BoardRepository;
  audit: AuditRepository;
}

const NO_INVITE = 'Convite não encontrado';

/** Convites recebidos. Aceitar e recusar vão sem corpo. */
export function registerInviteRoutes(app: FastifyInstance, deps: InviteRouteDeps): void {
  app.get('/api/invites', async (request): Promise<InviteListResponse> => ({
    invites: deps.boards.invitesFor((request.user as UserRecord).id),
  }));

  app.post('/api/invites/:boardId/accept', async (request): Promise<BoardSummary> => {
    const user = request.user as UserRecord;
    const { boardId } = validate(boardIdParamsSchema, request.params);
    if (!deps.boards.accept(boardId, user.id)) throw notFound(NO_INVITE);
    deps.audit.record(user.id, 'invite.accept', { kind: 'board', id: boardId });
    const board = deps.boards.get(boardId);
    if (!board) throw notFound(NO_INVITE);
    return { id: board.id, name: board.name, kind: board.kind, role: 'editor' };
  });

  app.post('/api/invites/:boardId/decline', async (request, reply) => {
    const user = request.user as UserRecord;
    const { boardId } = validate(boardIdParamsSchema, request.params);
    if (!deps.boards.decline(boardId, user.id)) throw notFound(NO_INVITE);
    deps.audit.record(user.id, 'invite.decline', { kind: 'board', id: boardId });
    return reply.status(204).send();
  });
}
