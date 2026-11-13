import type { ResetResponse } from '@quadro/shared';
import type { FastifyInstance } from 'fastify';
import type { TaskRepository } from '../repositories/taskRepository';

export function registerBoardRoutes(app: FastifyInstance, repo: TaskRepository): void {
  app.post('/api/board/reset', async (): Promise<ResetResponse> => repo.reset());
}
