import type { BoardSummary, Member, ResetResponse, Task } from '@quadro/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp, type TestClient } from '../../test/helpers/testApp';

let t: TestApp;
let ana: TestClient;
let bia: TestClient;

beforeEach(async () => {
  t = await createTestApp();
  ana = await t.signIn('ana@example.com', { username: 'ana', displayName: 'Ana' });
  bia = await t.signIn('bia@example.com', { username: 'bia', displayName: 'Bia' });
});
afterEach(async () => t.close());

async function newGroup(owner: TestClient, name = 'Equipe'): Promise<BoardSummary> {
  const res = await owner.request('POST', '/api/boards', { name });
  expect(res.statusCode).toBe(201);
  return res.json() as BoardSummary;
}

async function joinGroup(owner: TestClient, member: TestClient, boardId: number): Promise<void> {
  expect((await owner.request('POST', `/api/boards/${boardId}/invites`, { handle: member.handle })).statusCode).toBe(201);
  expect((await member.request('POST', `/api/invites/${boardId}/accept`)).statusCode).toBe(200);
}

const boardsOf = async (client: TestClient) => ((await client.request('GET', '/api/boards')).json() as { boards: BoardSummary[] }).boards;

describe('quadros', () => {
  it('cada pessoa começa com o próprio quadro pessoal', async () => {
    expect(await boardsOf(ana)).toEqual([{ id: ana.boardId, name: 'Meu quadro', kind: 'personal', role: 'owner' }]);
    expect(await boardsOf(t)).toEqual([{ id: 1, name: 'Meu quadro', kind: 'personal', role: 'owner' }]);
  });

  it('criar um grupo faz de quem criou o dono; o grupo aparece depois do pessoal', async () => {
    const group = await newGroup(ana, 'Projeto X');
    expect(group).toMatchObject({ name: 'Projeto X', kind: 'group', role: 'owner' });
    expect((await boardsOf(ana)).map((b) => b.kind)).toEqual(['personal', 'group']);
  });

  it('nome de quadro com caracteres de direção ou vazio é recusado', async () => {
    expect((await ana.request('POST', '/api/boards', { name: 'Equipe‮' })).statusCode).toBe(400);
    expect((await ana.request('POST', '/api/boards', { name: '  ' })).statusCode).toBe(400);
    expect((await ana.request('POST', '/api/boards', { name: 'x', kind: 'personal' })).statusCode).toBe(400);
  });

  it('só o dono renomeia e apaga; o quadro pessoal não pode ser apagado', async () => {
    const group = await newGroup(ana);
    await joinGroup(ana, bia, group.id);
    expect((await bia.request('PATCH', `/api/boards/${group.id}`, { name: 'Tomado' })).statusCode).toBe(403);
    expect((await bia.request('DELETE', `/api/boards/${group.id}`)).statusCode).toBe(403);
    const renamed = await ana.request('PATCH', `/api/boards/${group.id}`, { name: 'Novo nome' });
    expect(renamed.json()).toMatchObject({ name: 'Novo nome', role: 'owner' });
    expect((await ana.request('DELETE', `/api/boards/${ana.boardId}`)).statusCode).toBe(400);
    expect((await ana.request('DELETE', `/api/boards/${group.id}`)).statusCode).toBe(204);
    expect((await boardsOf(bia)).map((b) => b.kind)).toEqual(['personal']);
  });

  it('quem não é membro recebe 404 em tudo do quadro', async () => {
    const group = await newGroup(ana);
    for (const [method, url, body] of [
      ['GET', `/api/boards/${group.id}/tasks`, undefined],
      ['GET', `/api/boards/${group.id}/members`, undefined],
      ['PATCH', `/api/boards/${group.id}`, { name: 'x' }],
      ['DELETE', `/api/boards/${group.id}`, undefined],
      ['POST', `/api/boards/${group.id}/invites`, { handle: bia.handle }],
      ['POST', `/api/boards/${group.id}/reset`, undefined],
      ['GET', '/api/boards/99999/tasks', undefined],
    ] as const) {
      const res = await bia.request(method, url, body);
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
  });
});

describe('tarefas no quadro do grupo', () => {
  it('membro ativo cria, move e vê as tarefas do grupo; o convidado pendente não', async () => {
    const group = await newGroup(ana);
    expect((await ana.request('POST', `/api/boards/${group.id}/invites`, { handle: bia.handle })).statusCode).toBe(201);
    expect((await bia.request('GET', `/api/boards/${group.id}/tasks`)).statusCode).toBe(404);

    await bia.request('POST', `/api/invites/${group.id}/accept`);
    const created = await bia.request('POST', `/api/boards/${group.id}/tasks`, { title: 'Da Bia', position: { kind: 'cell', day: 0, slot: 0 } });
    expect(created.statusCode).toBe(201);
    const task = created.json() as Task;
    expect(task.boardId).toBe(group.id);
    expect((await ana.request('PUT', `/api/tasks/${task.id}/position`, { to: { kind: 'cell', day: 1, slot: 2 } })).statusCode).toBe(200);
    const seen = ((await ana.request('GET', `/api/boards/${group.id}/tasks`)).json() as { tasks: Task[] }).tasks;
    expect(seen).toEqual([expect.objectContaining({ title: 'Da Bia', day: 1, slot: 2 })]);
  });

  it('reset devolve ao deck só as tarefas daquele quadro', async () => {
    await t.request('POST', '/api/boards/1/tasks', { title: 'Do admin', position: { kind: 'cell', day: 0, slot: 0 } });
    await ana.request('POST', `/api/boards/${ana.boardId}/tasks`, { title: 'Da Ana', position: { kind: 'cell', day: 0, slot: 0 } });
    const res = await ana.request('POST', `/api/boards/${ana.boardId}/reset`);
    expect((res.json() as ResetResponse).moved).toBe(1);
    const adminTasks = ((await t.request('GET', '/api/boards/1/tasks')).json() as { tasks: Task[] }).tasks;
    expect(adminTasks[0]).toMatchObject({ day: 0, slot: 0 });
  });

  it('reset de quadro vazio não move nada; sem o header do cliente é bloqueado', async () => {
    expect((await ana.request('POST', `/api/boards/${ana.boardId}/reset`)).json()).toEqual({ tasks: [], moved: 0 });
    const raw = await t.raw({ method: 'POST', url: '/api/boards/1/reset', headers: { host: '127.0.0.1:3001', cookie: t.cookie } });
    expect(raw.statusCode).toBe(403);
  });
});

describe('convites e membros', () => {
  it('convidar por handle: a pessoa aparece como convidada e precisa aceitar', async () => {
    const group = await newGroup(ana);
    const res = await ana.request('POST', `/api/boards/${group.id}/invites`, { handle: bia.handle });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ userId: bia.userId, handle: 'bia_02', displayName: 'Bia', role: 'editor', status: 'invited' });
    expect((await boardsOf(bia)).map((b) => b.id)).not.toContain(group.id);
  });

  it('handle inexistente, desativado ou mal formado: mesma resposta, sem revelar quem existe', async () => {
    const group = await newGroup(ana);
    const unknown = await ana.request('POST', `/api/boards/${group.id}/invites`, { handle: 'zezinho_99' });
    t.temp.db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(bia.userId);
    const disabled = await ana.request('POST', `/api/boards/${group.id}/invites`, { handle: bia.handle });
    expect(unknown.statusCode).toBe(404);
    expect(disabled.statusCode).toBe(404);
    expect(disabled.json()).toEqual(unknown.json());
    expect((await ana.request('POST', `/api/boards/${group.id}/invites`, { handle: 'bia_2' })).statusCode).toBe(400);
  });

  it('convidar de novo quem já está ou já foi convidado dá 409; convidar a si mesmo dá 400', async () => {
    const group = await newGroup(ana);
    await ana.request('POST', `/api/boards/${group.id}/invites`, { handle: bia.handle });
    expect((await ana.request('POST', `/api/boards/${group.id}/invites`, { handle: bia.handle })).statusCode).toBe(409);
    expect((await ana.request('POST', `/api/boards/${group.id}/invites`, { handle: ana.handle })).statusCode).toBe(400);
  });

  it('o quadro pessoal não aceita convites; só o dono convida', async () => {
    expect((await ana.request('POST', `/api/boards/${ana.boardId}/invites`, { handle: bia.handle })).statusCode).toBe(400);
    const group = await newGroup(ana);
    await joinGroup(ana, bia, group.id);
    const carla = await t.signIn('carla@example.com', { username: 'carla', displayName: 'Carla' });
    expect((await bia.request('POST', `/api/boards/${group.id}/invites`, { handle: carla.handle })).statusCode).toBe(403);
  });

  it('a lista de membros mostra handle, nome de exibição e papel, só para membro ativo', async () => {
    const group = await newGroup(ana);
    await ana.request('POST', `/api/boards/${group.id}/invites`, { handle: bia.handle });
    expect((await bia.request('GET', `/api/boards/${group.id}/members`)).statusCode).toBe(404);
    const members = ((await ana.request('GET', `/api/boards/${group.id}/members`)).json() as { members: Member[] }).members;
    expect(members).toEqual([
      { userId: ana.userId, handle: 'ana_01', displayName: 'Ana', role: 'owner', status: 'active' },
      { userId: bia.userId, handle: 'bia_02', displayName: 'Bia', role: 'editor', status: 'invited' },
    ]);
    expect(JSON.stringify(members)).not.toContain('@');
  });

  it('o dono remove membros (e cancela convites); o membro sai sozinho; o dono não sai', async () => {
    const group = await newGroup(ana);
    await joinGroup(ana, bia, group.id);
    const carla = await t.signIn('carla@example.com', { username: 'carla', displayName: 'Carla' });
    await ana.request('POST', `/api/boards/${group.id}/invites`, { handle: carla.handle });

    expect((await bia.request('DELETE', `/api/boards/${group.id}/members/${carla.userId}`)).statusCode).toBe(403);
    expect((await ana.request('DELETE', `/api/boards/${group.id}/members/${carla.userId}`)).statusCode).toBe(204);
    expect(((await carla.request('GET', '/api/invites')).json() as { invites: unknown[] }).invites).toEqual([]);

    expect((await ana.request('DELETE', `/api/boards/${group.id}/members/${ana.userId}`)).statusCode).toBe(409);
    expect((await bia.request('DELETE', `/api/boards/${group.id}/members/${bia.userId}`)).statusCode).toBe(204);
    expect((await bia.request('GET', `/api/boards/${group.id}/tasks`)).statusCode).toBe(404);
    expect((await ana.request('DELETE', `/api/boards/${group.id}/members/${bia.userId}`)).statusCode).toBe(404);
  });

  it('o audit_log registra as ações de quadro, sem e-mail nem handle', async () => {
    const group = await newGroup(ana);
    await joinGroup(ana, bia, group.id);
    const actions = (t.temp.db.prepare('SELECT action FROM audit_log WHERE target_kind = ? ORDER BY id').all('board') as Array<{
      action: string;
    }>).map((r) => r.action);
    expect(actions).toEqual(['board.create', 'invite.create', 'invite.accept']);
    expect(JSON.stringify(t.temp.db.prepare('SELECT * FROM audit_log').all())).not.toMatch(/example\.com|bia_02/);
  });
});
