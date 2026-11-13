import {
  MoveError,
  createTaskSchema,
  moveBodySchema,
  taskIdParamsSchema,
  updateTaskSchema,
  type TaskListResponse,
} from '@quadro/shared';
import type { FastifyInstance } from 'fastify';
import { HttpError, notFound } from '../http/errors';
import { validate } from '../http/validate';
import type { TaskRepository } from '../repositories/taskRepository';

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
    const task = repo.create(input);
    return reply.status(201).send(task);
  });

  app.patch('/api/tasks/:id', async (request) => {
    const { id } = validate(taskIdParamsSchema, request.params);
    const patch = validate(updateTaskSchema, request.body);
    const task = repo.update(id, patch);
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
    try {
      return { tasks: repo.move(id, to) };
    } catch (error) {
      if (error instanceof MoveError) {
        throw error.code === 'NOT_FOUND' ? notFound() : new HttpError(400, 'VALIDATION', error.message);
      }
      throw error;
    }
  });
}
