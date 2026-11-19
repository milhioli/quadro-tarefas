import { userIdParamsSchema, type AdminUserListResponse, type UserStatus } from '@quadro/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HttpError, forbidden, notFound, routeNotFound } from '../http/errors';
import { hasClientHeader } from '../http/guard';
import { validate } from '../http/validate';
import type { NameSuggestions } from '../auth/nameSuggestions';
import { auditDeletedAccount, type AccountRepository } from '../repositories/accountRepository';
import type { AuditRepository } from '../repositories/auditRepository';
import type { UserRecord, UserRepository } from '../repositories/userRepository';

export interface AdminRouteDeps {
  users: UserRepository;
  audit: AuditRepository;
  accounts: AccountRepository;
  suggestions: NameSuggestions;
}

/**
 * Rotas do admin (`seq 0`), Fase 2b (R10). O admin NÃO ganha acesso a quadros,
 * tarefas nem agendas de ninguém: só vê handle, e-mail, status e último
 * acesso, desativa ou reativa contas e apaga uma conta já desativada (pedido
 * de exclusão que chegou pelo contato). Tudo vai para o audit_log.
 *
 * Para quem não é admin, a resposta é a mesma de uma rota que não existe.
 */
export function registerAdminRoutes(app: FastifyInstance, deps: AdminRouteDeps): void {
  async function requireAdmin(request: FastifyRequest): Promise<void> {
    if (request.user?.role !== 'admin') throw routeNotFound();
  }
  const admin = (request: FastifyRequest) => request.user as UserRecord;

  app.get('/api/admin/users', { preHandler: requireAdmin }, async (request): Promise<AdminUserListResponse> => {
    // Cada listagem grava uma linha de auditoria: uma navegação com o cookie não pode disparar isso.
    if (!hasClientHeader(request)) throw forbidden();
    deps.audit.record(admin(request).id, 'admin.users.list');
    return { users: deps.users.listForAdmin() };
  });

  function registerStatusRoute(action: 'disable' | 'enable', status: UserStatus) {
    app.post(`/api/admin/users/:userId/${action}`, { preHandler: requireAdmin }, async (request, reply) => {
      const self = admin(request);
      const { userId } = validate(userIdParamsSchema, request.params);
      if (userId === self.id) throw new HttpError(409, 'CONFLICT', 'Você não pode mudar o status da própria conta');
      if (!deps.users.get(userId)) throw notFound('Conta não encontrada');
      if (deps.users.setStatus(userId, status)) {
        deps.audit.record(self.id, status === 'disabled' ? 'user.disable' : 'user.enable', { kind: 'user', id: userId });
      }
      return reply.status(204).send();
    });
  }
  registerStatusRoute('disable', 'disabled');
  registerStatusRoute('enable', 'active');

  // Só conta desativada: desativar primeiro derruba as sessões e deixa o passo deliberado.
  app.post('/api/admin/users/:userId/delete', { preHandler: requireAdmin }, async (request, reply) => {
    const self = admin(request);
    const { userId } = validate(userIdParamsSchema, request.params);
    if (userId === self.id) throw new HttpError(409, 'CONFLICT', 'Você não pode apagar a própria conta');
    const target = deps.users.get(userId);
    if (!target) throw notFound('Conta não encontrada');
    if (target.status !== 'disabled') {
      throw new HttpError(409, 'CONFLICT', 'Desative a conta antes de apagar');
    }
    const result = deps.accounts.deleteAccount(userId);
    if (result) auditDeletedAccount(deps.audit, self.id, result);
    deps.suggestions.delete(userId);
    return reply.status(204).send();
  });
}
