import {
  MoveError,
  moveBodySchema,
  taskIdParamsSchema,
  updateTaskSchema,
  type TaskListResponse,
} from '@quadro/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HttpError, conflict, notFound } from '../http/errors';
import { validate } from '../http/validate';
import type { BoardRepository } from '../repositories/boardRepository';
import type { TaskRepository, TaskStore } from '../repositories/taskRepository';
import type { UserRecord } from '../repositories/userRepository';

/** Converte erros de posição em respostas HTTP; outros erros seguem adiante. */
export function moveErrorToHttp(error: unknown): unknown {
  if (!(error instanceof MoveError)) return error;
  switch (error.code) {
    case 'NOT_FOUND':
      return notFound();
    case 'OCCUPIED':
      return conflict();
    case 'INVALID_TARGET':
      return new HttpError(400, 'VALIDATION', error.message);
  }
}

export function withMoveErrors<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    throw moveErrorToHttp(error);
  }
}

export interface TaskRouteDeps {
  store: TaskStore;
  boards: BoardRepository;
}

/**
 * Rotas de UMA tarefa (`/api/tasks/:id`). O quadro vem da própria linha, e não
 * do cliente: uma consulta só decide se a tarefa existe e se a pessoa é membro
 * ativo do quadro dela. Qualquer "não" é 404 (o mesmo de "não existe").
 * As rotas da lista e da criação ficam em `/api/boards/:boardId/...` (routes/boards.ts).
 */
export function registerTaskRoutes(app: FastifyInstance, deps: TaskRouteDeps): void {
  function taskRepo(request: FastifyRequest, id: number): TaskRepository {
    const user = request.user as UserRecord;
    const boardId = deps.boards.taskBoardForMember(id, user.id);
    if (boardId === null) throw notFound();
    return deps.store.forBoard(boardId, user.id);
  }

  app.get('/api/tasks/:id', async (request) => {
    const { id } = validate(taskIdParamsSchema, request.params);
    const task = taskRepo(request, id).get(id);
    if (!task) throw notFound();
    return task;
  });

  app.patch('/api/tasks/:id', async (request) => {
    const { id } = validate(taskIdParamsSchema, request.params);
    const repo = taskRepo(request, id);
    const patch = validate(updateTaskSchema, request.body);
    const task = withMoveErrors(() => repo.update(id, patch));
    if (!task) throw notFound();
    return task;
  });

  app.delete('/api/tasks/:id', async (request, reply) => {
    const { id } = validate(taskIdParamsSchema, request.params);
    if (!taskRepo(request, id).remove(id)) throw notFound();
    return reply.status(204).send();
  });

  app.put('/api/tasks/:id/position', async (request): Promise<TaskListResponse> => {
    const { id } = validate(taskIdParamsSchema, request.params);
    const repo = taskRepo(request, id);
    const { to } = validate(moveBodySchema, request.body);
    return { tasks: withMoveErrors(() => repo.move(id, to)) };
  });
}
