import {
  boardIdParamsSchema,
  boardInputSchema,
  createTaskSchema,
  inviteInputSchema,
  memberParamsSchema,
  type BoardListResponse,
  type BoardSummary,
  type MemberListResponse,
  type ResetResponse,
  type TaskListResponse,
} from '@quadro/shared';
import type { FastifyInstance } from 'fastify';
import { requireMember } from '../auth/access';
import { HttpError, forbidden, notFound } from '../http/errors';
import { validate } from '../http/validate';
import type { AuditRepository } from '../repositories/auditRepository';
import type { BoardRepository } from '../repositories/boardRepository';
import type { TaskStore } from '../repositories/taskRepository';
import { hasProfile, type UserRecord, type UserRepository } from '../repositories/userRepository';
import { withMoveErrors } from './tasks';

export interface BoardRouteDeps {
  boards: BoardRepository;
  store: TaskStore;
  users: UserRepository;
  audit: AuditRepository;
}

/** Handle inexistente, conta desativada ou sem perfil: a mesma resposta (não revela quem existe). */
const UNKNOWN_HANDLE = 'Nenhuma conta com esse nome de usuário';

export function registerBoardRoutes(app: FastifyInstance, deps: BoardRouteDeps): void {
  const userOf = (request: { user: UserRecord | null }) => request.user as UserRecord;

  // ---------- Quadros ----------

  app.get('/api/boards', async (request): Promise<BoardListResponse> => ({
    boards: deps.boards.listForUser(userOf(request).id),
  }));

  app.post('/api/boards', async (request, reply) => {
    const user = userOf(request);
    const { name } = validate(boardInputSchema, request.body);
    const board: BoardSummary = deps.boards.createGroup(user.id, name);
    deps.audit.record(user.id, 'board.create', { kind: 'board', id: board.id });
    return reply.status(201).send(board);
  });

  app.patch('/api/boards/:boardId', async (request): Promise<BoardSummary> => {
    const user = userOf(request);
    const { boardId } = validate(boardIdParamsSchema, request.params);
    const membership = requireMember(deps.boards, boardId, user.id, 'owner');
    const { name } = validate(boardInputSchema, request.body);
    deps.boards.rename(boardId, name);
    deps.audit.record(user.id, 'board.rename', { kind: 'board', id: boardId });
    const board = deps.boards.get(boardId);
    if (!board) throw notFound('Quadro não encontrado');
    return { id: board.id, name: board.name, kind: board.kind, role: membership.role };
  });

  app.delete('/api/boards/:boardId', async (request, reply) => {
    const user = userOf(request);
    const { boardId } = validate(boardIdParamsSchema, request.params);
    requireMember(deps.boards, boardId, user.id, 'owner');
    if (deps.boards.get(boardId)?.kind !== 'group') {
      throw new HttpError(400, 'VALIDATION', 'O quadro pessoal não pode ser apagado');
    }
    deps.boards.delete(boardId);
    deps.audit.record(user.id, 'board.delete', { kind: 'board', id: boardId });
    return reply.status(204).send();
  });

  // ---------- Tarefas do quadro ----------

  app.get('/api/boards/:boardId/tasks', async (request): Promise<TaskListResponse> => {
    const user = userOf(request);
    const { boardId } = validate(boardIdParamsSchema, request.params);
    requireMember(deps.boards, boardId, user.id);
    return { tasks: deps.store.forBoard(boardId, user.id).list() };
  });

  app.post('/api/boards/:boardId/tasks', async (request, reply) => {
    const user = userOf(request);
    const { boardId } = validate(boardIdParamsSchema, request.params);
    requireMember(deps.boards, boardId, user.id);
    const input = validate(createTaskSchema, request.body);
    const task = withMoveErrors(() => deps.store.forBoard(boardId, user.id).create(input));
    return reply.status(201).send(task);
  });

  app.post('/api/boards/:boardId/reset', async (request): Promise<ResetResponse> => {
    const user = userOf(request);
    const { boardId } = validate(boardIdParamsSchema, request.params);
    requireMember(deps.boards, boardId, user.id);
    return deps.store.forBoard(boardId, user.id).reset();
  });

  // ---------- Membros e convites ----------

  app.get('/api/boards/:boardId/members', async (request): Promise<MemberListResponse> => {
    const user = userOf(request);
    const { boardId } = validate(boardIdParamsSchema, request.params);
    // Só membro ativo: quem tem convite pendente vê só o nome do quadro e quem convidou (em /api/invites).
    requireMember(deps.boards, boardId, user.id);
    return { members: deps.boards.members(boardId) };
  });

  app.post('/api/boards/:boardId/invites', async (request, reply) => {
    const user = userOf(request);
    const { boardId } = validate(boardIdParamsSchema, request.params);
    requireMember(deps.boards, boardId, user.id, 'owner');
    if (deps.boards.get(boardId)?.kind !== 'group') {
      throw new HttpError(400, 'VALIDATION', 'O quadro pessoal não aceita membros. Crie um grupo para convidar alguém.');
    }
    const { handle } = validate(inviteInputSchema, request.body);
    const invitee = deps.users.findByHandle(handle.username, handle.seq);
    if (!invitee || invitee.status !== 'active' || !hasProfile(invitee)) throw notFound(UNKNOWN_HANDLE);
    if (invitee.id === user.id) throw new HttpError(400, 'VALIDATION', 'Você já está neste quadro');
    if (deps.boards.invite(boardId, user.id, invitee.id) === 'already-member') {
      throw new HttpError(409, 'CONFLICT', 'Essa pessoa já está no quadro ou já foi convidada');
    }
    deps.audit.record(user.id, 'invite.create', { kind: 'board', id: boardId });
    const member = deps.boards.members(boardId).find((m) => m.userId === invitee.id);
    return reply.status(201).send(member);
  });

  app.delete('/api/boards/:boardId/members/:userId', async (request, reply) => {
    const user = userOf(request);
    const { boardId, userId } = validate(memberParamsSchema, request.params);
    const membership = requireMember(deps.boards, boardId, user.id);
    if (userId === user.id) {
      // Sair do quadro. O dono não sai: apaga o grupo (passar a posse é da 2b).
      if (membership.role === 'owner') {
        throw new HttpError(409, 'CONFLICT', 'O dono não pode sair do quadro. Apague o grupo se ele não for mais usado.');
      }
      deps.boards.removeMember(boardId, userId);
      deps.audit.record(user.id, 'member.leave', { kind: 'board', id: boardId });
      return reply.status(204).send();
    }
    if (membership.role !== 'owner') throw forbidden();
    if (!deps.boards.removeMember(boardId, userId)) throw notFound('Essa pessoa não está no quadro');
    deps.audit.record(user.id, 'member.remove', { kind: 'board', id: boardId });
    return reply.status(204).send();
  });
}
