import type { PublicInfo } from '@quadro/shared';
import type { FastifyInstance } from 'fastify';

/**
 * `GET /api/info` (público): o contato de privacidade e quem responde pelo app,
 * para o rodapé e a /privacidade (que abrem sem login).
 */
export function registerInfoRoutes(app: FastifyInstance, info: PublicInfo): void {
  const body: PublicInfo = Object.freeze({ contactEmail: info.contactEmail, operatorName: info.operatorName });
  app.get('/api/info', { config: { public: true } }, async () => body);
}
