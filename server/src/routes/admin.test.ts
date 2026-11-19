import type { AdminUser } from '@quadro/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { TEST_HOST, createTestApp, type TestApp, type TestClient } from '../../test/helpers/testApp';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const UNKNOWN_ROUTE = { error: { code: 'NOT_FOUND', message: 'Rota não encontrada' } };

/** GET da lista com o header do cliente (a rota grava auditoria, então exige o header). */
function listAs(app: TestApp, client: Pick<TestClient, 'cookie'>, withClientHeader = true) {
  return app.raw({
    method: 'GET',
    url: '/api/admin/users',
    headers: { host: TEST_HOST, cookie: client.cookie, ...(withClientHeader ? { 'x-quadro-client': '1' } : {}) },
  });
}

const auditActions = (app: TestApp) =>
  (app.temp.db.prepare('SELECT action, actor_user_id, target_kind, target_id FROM audit_log WHERE action LIKE ? ORDER BY id').all(
    'user.%',
  ) as Array<{ action: string; actor_user_id: number; target_kind: string; target_id: number }>);

describe('rotas de admin: só o admin enxerga', () => {
  it('para quem não é admin, a resposta é a de uma rota que não existe, mesmo com id inválido', async () => {
    t = await createTestApp();
    const ana = await t.signIn('ana@example.com', { username: 'ana', displayName: 'Ana' });
    const list = await listAs(t, ana);
    expect(list.statusCode).toBe(404);
    expect(list.json()).toEqual(UNKNOWN_ROUTE);
    for (const url of [`/api/admin/users/${t.userId}/disable`, '/api/admin/users/abc/enable', '/api/admin/users/0/disable']) {
      const res = await ana.request('POST', url);
      expect(res.statusCode, url).toBe(404);
      expect(res.json()).toEqual(UNKNOWN_ROUTE);
    }
    expect((await t.request('GET', '/api/nao-existe')).json()).toEqual(UNKNOWN_ROUTE);
  });

  it('sem sessão: 401, como toda rota fora da lista pública', async () => {
    t = await createTestApp();
    expect((await t.anonymous('GET', '/api/admin/users')).statusCode).toBe(401);
    expect((await t.anonymous('POST', '/api/admin/users/2/disable')).statusCode).toBe(401);
  });

  it('a lista exige o header do cliente (uma navegação com o cookie não grava auditoria)', async () => {
    t = await createTestApp();
    expect((await listAs(t, t, false)).statusCode).toBe(403);
    expect(t.temp.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'admin.users.list'").get()).toEqual({ n: 0 });
  });

  it('lista só handle, e-mail, status e último acesso, e registra a consulta', async () => {
    t = await createTestApp();
    await t.signIn('ana@example.com', { username: 'ana', displayName: 'Ana' });
    const res = await listAs(t, t);
    expect(res.statusCode).toBe(200);
    const users = (res.json() as { users: AdminUser[] }).users;
    expect(users.map((u) => u.handle).sort()).toEqual(['admin.teste_00', 'ana_01']);
    for (const user of users) expect(Object.keys(user).sort()).toEqual(['email', 'handle', 'id', 'lastSeenAt', 'status']);
    expect(users.find((u) => u.handle === 'ana_01')).toMatchObject({ email: 'ana@example.com', status: 'active' });
    expect(t.temp.db.prepare("SELECT actor_user_id, target_kind FROM audit_log WHERE action = 'admin.users.list'").all()).toEqual([
      { actor_user_id: t.userId, target_kind: null },
    ]);
  });

  it('o admin continua sem acesso aos quadros e tarefas dos outros', async () => {
    t = await createTestApp();
    const ana = await t.signIn('ana@example.com', { username: 'ana', displayName: 'Ana' });
    const task = (await ana.request('POST', `/api/boards/${ana.boardId}/tasks`, { title: 'Privada' })).json() as { id: number };
    expect((await t.request('GET', `/api/boards/${ana.boardId}/tasks`)).statusCode).toBe(404);
    expect((await t.request('GET', `/api/tasks/${task.id}`)).statusCode).toBe(404);
  });
});

describe('desativar e reativar contas', () => {
  it('desativar derruba as sessões na hora e impede o login; reativar devolve o acesso', async () => {
    t = await createTestApp();
    const ana = await t.signIn('ana@example.com', { username: 'ana', displayName: 'Ana' });
    expect((await t.request('POST', `/api/admin/users/${ana.userId}/disable`)).statusCode).toBe(204);
    expect((await ana.request('GET', '/api/boards')).statusCode).toBe(401);
    expect(t.temp.db.prepare('SELECT status, disabled_at FROM users WHERE id = ?').get(ana.userId)).toEqual({
      status: 'disabled',
      disabled_at: '2026-11-13T12:00:00.000Z',
    });
    await expect(t.signIn('ana@example.com')).rejects.toThrow(/403/);

    expect((await t.request('POST', `/api/admin/users/${ana.userId}/enable`)).statusCode).toBe(204);
    expect(t.temp.db.prepare('SELECT status, disabled_at FROM users WHERE id = ?').get(ana.userId)).toEqual({
      status: 'active',
      disabled_at: null,
    });
    const back = await t.signIn('ana@example.com');
    expect((await back.request('GET', '/api/boards')).statusCode).toBe(200);
  });

  it('a auditoria registra só quando o status muda, sem e-mail', async () => {
    t = await createTestApp();
    const ana = await t.signIn('ana@example.com', { username: 'ana', displayName: 'Ana' });
    await t.request('POST', `/api/admin/users/${ana.userId}/disable`);
    await t.request('POST', `/api/admin/users/${ana.userId}/disable`);
    await t.request('POST', `/api/admin/users/${ana.userId}/enable`);
    expect(auditActions(t)).toEqual([
      { action: 'user.disable', actor_user_id: t.userId, target_kind: 'user', target_id: ana.userId },
      { action: 'user.enable', actor_user_id: t.userId, target_kind: 'user', target_id: ana.userId },
    ]);
    expect(JSON.stringify(t.temp.db.prepare('SELECT * FROM audit_log').all())).not.toContain('example.com');
  });

  it('o admin não muda a própria conta; conta inexistente dá 404', async () => {
    t = await createTestApp();
    const self = await t.request('POST', `/api/admin/users/${t.userId}/disable`);
    expect(self.statusCode).toBe(409);
    expect((await t.request('POST', '/api/admin/users/9999/disable')).json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Conta não encontrada' },
    });
  });
});

describe('apagar conta desativada (pedido que chegou pelo contato)', () => {
  it('conta ativa não pode ser apagada; desativada é apagada, com auditoria sem e-mail', async () => {
    t = await createTestApp();
    const ana = await t.signIn('ana@example.com', { username: 'ana', displayName: 'Ana' });
    const active = await t.request('POST', `/api/admin/users/${ana.userId}/delete`);
    expect(active.statusCode).toBe(409);
    expect(active.json().error.message).toBe('Desative a conta antes de apagar');

    await t.request('POST', `/api/admin/users/${ana.userId}/disable`);
    expect((await t.request('POST', `/api/admin/users/${ana.userId}/delete`)).statusCode).toBe(204);
    expect(t.temp.db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(ana.userId)).toEqual({ n: 0 });
    expect(t.temp.db.prepare("SELECT actor_user_id, target_id FROM audit_log WHERE action = 'account.delete'").all()).toEqual([
      { actor_user_id: t.userId, target_id: null },
    ]);
    expect((await t.request('POST', `/api/admin/users/${ana.userId}/delete`)).statusCode).toBe(404);
  });

  it('o admin não apaga a si mesmo, e quem não é admin recebe o 404 de rota desconhecida', async () => {
    t = await createTestApp();
    expect((await t.request('POST', `/api/admin/users/${t.userId}/delete`)).statusCode).toBe(409);
    const ana = await t.signIn('ana@example.com', { username: 'ana', displayName: 'Ana' });
    const res = await ana.request('POST', `/api/admin/users/${t.userId}/delete`);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual(UNKNOWN_ROUTE);
  });
});

describe('último acesso', () => {
  it('é gravado no login e renovado no máximo uma vez por hora', async () => {
    let time = Date.parse('2026-11-13T12:00:00.000Z');
    t = await createTestApp({ now: () => new Date(time) });
    const ana = await t.signIn('ana@example.com', { username: 'ana', displayName: 'Ana' });
    const lastSeen = () => (t!.temp.db.prepare('SELECT last_seen_at FROM users WHERE id = ?').get(ana.userId) as { last_seen_at: string }).last_seen_at;
    expect(lastSeen()).toBe('2026-11-13T12:00:00.000Z');
    time += 30 * 60_000;
    await ana.request('GET', '/api/boards');
    expect(lastSeen()).toBe('2026-11-13T12:00:00.000Z');
    time += 31 * 60_000;
    await ana.request('GET', '/api/boards');
    expect(lastSeen()).toBe('2026-11-13T13:01:00.000Z');
  });
});
