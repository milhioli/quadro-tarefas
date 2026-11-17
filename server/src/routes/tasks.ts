import {
  MoveError,
  createTaskSchema,
  moveBodySchema,
  taskIdParamsSchema,
  updateTaskSchema,
  type TaskListResponse,
} from '@quadro/shared';
import type { FastifyInstance } from 'fastify';
import { HttpError, conflict, notFound } from '../http/errors';
import { validate } from '../http/validate';
import type { TaskRepository } from '../repositories/taskRepository';

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

function withMoveErrors<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    throw moveErrorToHttp(error);
  }
}

/** Rotas registradas direto na raiz, para herdar o guard e os headers globais. */
export function registerTaskRoutes(app: FastifyInstance, repo: TaskRepository): void {
  app.get('/api/tasks', async (): Promise<TaskListResponse> => ({ tasks: repo.list() }));

  app.get('/api/tasks/:id', async (request) => {
    const { id } = validate(taskIdParamsSchema, request.params);
    const task = repo.get(id);
    if (!task) throw notFound();
    return task;
  });

  app.post('/api/tasks', async (request, reply) => {
    const input = validate(createTaskSchema, request.body);
    const task = withMoveErrors(() => repo.create(input));
    return reply.status(201).send(task);
  });

  app.patch('/api/tasks/:id', async (request) => {
    const { id } = validate(taskIdParamsSchema, request.params);
    const patch = validate(updateTaskSchema, request.body);
    const task = withMoveErrors(() => repo.update(id, patch));
    if (!task) throw notFound();
    return task;
  });

  app.delete('/api/tasks/:id', async (request, reply) => {
    const { id } = validate(taskIdParamsSchema, request.params);
    if (!repo.remove(id)) throw notFound();
    return reply.status(204).send();
  });

  app.put('/api/tasks/:id/position', async (request): Promise<TaskListResponse> => {
    const { id } = validate(taskIdParamsSchema, request.params);
    const { to } = validate(moveBodySchema, request.body);
    return { tasks: withMoveErrors(() => repo.move(id, to)) };
  });
}
