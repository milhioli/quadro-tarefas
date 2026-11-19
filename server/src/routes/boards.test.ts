import type { BoardSummary, Member, ResetResponse, Task } from '@quadro/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp, type TestClient } from '../../test/helpers/testApp';
import type { TaskLimits } from '../repositories/taskRepository';

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

describe('limites e tetos (Fase 2b)', () => {
  const NOW = '2026-11-13T12:00:00.000Z';
  let nextPerson = 0;

  /** Pessoas com perfil, direto no banco (para encher um grupo sem 50 logins). */
  function addPeople(count: number): number[] {
    const insert = t.temp.db.prepare(
      `INSERT INTO users (google_sub, email, display_name, username, seq, created_at, last_seen_at)
       VALUES (?, ?, 'Pessoa', 'pessoa', (SELECT MAX(seq) + 1 FROM users), ?, ?)`,
    );
    return Array.from({ length: count }, () => {
      const n = nextPerson++;
      return Number(insert.run(`dev:p${n}`, `p${n}@example.com`, NOW, NOW).lastInsertRowid);
    });
  }

  function addMembers(boardId: number, ids: number[], status: 'active' | 'invited', invitedBy: number | null = null) {
    const insert = t.temp.db.prepare(
      "INSERT INTO board_members (board_id, user_id, role, status, invited_by, created_at) VALUES (?, ?, 'editor', ?, ?, ?)",
    );
    for (const id of ids) insert.run(boardId, id, status, invitedBy, NOW);
  }

  it('criar grupos: no máximo 10 por hora (429) e 20 por dono (409)', async () => {
    for (let i = 0; i < 10; i++) await newGroup(ana, `G${i}`);
    const limited = await ana.request('POST', '/api/boards', { name: 'G10' });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({
      error: { code: 'RATE_LIMITED', message: 'Muitas ações em pouco tempo. Espere alguns minutos e tente de novo.' },
    });
    // Outra pessoa não é afetada.
    await newGroup(bia, 'Da Bia');

    // Teto de 20 grupos por dono (com 20 já no banco).
    const insertBoard = t.temp.db.prepare("INSERT INTO boards (name, kind, created_at) VALUES ('X', 'group', ?)");
    const insertOwner = t.temp.db.prepare(
      "INSERT INTO board_members (board_id, user_id, role, status, created_at) VALUES (?, ?, 'owner', 'active', ?)",
    );
    for (let i = 0; i < 19; i++) insertOwner.run(Number(insertBoard.run(NOW).lastInsertRowid), bia.userId, NOW);
    const full = await bia.request('POST', '/api/boards', { name: 'Mais um' });
    expect(full.statusCode).toBe(409);
    expect(full.json()).toEqual({
      error: { code: 'CONFLICT', message: 'Você chegou ao limite de 20 grupos. Apague um grupo para criar outro.' },
    });
  });

  it('convites: no máximo 30 por dia, contando os handles que não existem', async () => {
    const group = await newGroup(ana);
    for (let i = 0; i < 30; i++) {
      const res = await ana.request('POST', `/api/boards/${group.id}/invites`, { handle: `ninguem_${String(i + 10)}` });
      expect(res.statusCode).toBe(404);
    }
    expect((await ana.request('POST', `/api/boards/${group.id}/invites`, { handle: bia.handle })).statusCode).toBe(429);
  });

  it('um convite pendente por par: o segundo, para outro grupo, é recusado', async () => {
    const first = await newGroup(ana, 'Primeiro');
    const second = await newGroup(ana, 'Segundo');
    expect((await ana.request('POST', `/api/boards/${first.id}/invites`, { handle: bia.handle })).statusCode).toBe(201);
    const again = await ana.request('POST', `/api/boards/${second.id}/invites`, { handle: bia.handle });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.message).toBe('Essa pessoa já tem um convite seu esperando resposta.');
  });

  it('grupo cheio (50 pessoas) e 20 convites pendentes por grupo', async () => {
    const group = await newGroup(ana);
    addMembers(group.id, addPeople(49), 'active');
    const full = await ana.request('POST', `/api/boards/${group.id}/invites`, { handle: bia.handle });
    expect(full.statusCode).toBe(409);
    expect(full.json().error.message).toBe('Este grupo chegou ao limite de 50 pessoas.');

    const other = await newGroup(ana, 'Outro');
    addMembers(other.id, addPeople(20), 'invited', ana.userId);
    const pending = await ana.request('POST', `/api/boards/${other.id}/invites`, { handle: bia.handle });
    expect(pending.statusCode).toBe(409);
    expect(pending.json().error.message).toMatch(/20 convites/);
  });

  it('o limite de mutações vale por pessoa e só para métodos que mudam algo', async () => {
    await t.close();
    // O perfil (POST /api/me/profile) já conta 1 das 4.
    t = await createTestApp({ rateLimits: { mutation: { limit: 4, windowMs: 60_000 } } });
    const carla = await t.signIn('carla@example.com', { username: 'carla', displayName: 'Carla' });
    for (let i = 0; i < 3; i++) {
      expect((await carla.request('POST', `/api/boards/${carla.boardId}/tasks`, { title: `T${i}` })).statusCode).toBe(201);
    }
    expect((await carla.request('GET', `/api/boards/${carla.boardId}/tasks`)).statusCode).toBe(200);
    const limited = await carla.request('POST', `/api/boards/${carla.boardId}/tasks`, { title: 'T3' });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    // Outra pessoa não é afetada pelo limite da Carla.
    const dani = await t.signIn('dani@example.com', { username: 'dani', displayName: 'Dani' });
    expect((await dani.request('POST', `/api/boards/${dani.boardId}/tasks`, { title: 'D' })).statusCode).toBe(201);
  });
});

describe('bloqueio de reconvite (30 dias, por par)', () => {
  let time: number;

  beforeEach(async () => {
    await t.close();
    time = Date.parse('2026-11-13T12:00:00.000Z');
    t = await createTestApp({ now: () => new Date(time) });
    ana = await t.signIn('ana@example.com', { username: 'ana', displayName: 'Ana' });
    bia = await t.signIn('bia@example.com', { username: 'bia', displayName: 'Bia' });
  });

  const invite = (owner: TestClient, boardId: number, who: TestClient) =>
    owner.request('POST', `/api/boards/${boardId}/invites`, { handle: who.handle });

  it('recusar bloqueia quem convidou por 30 dias, em qualquer grupo; outra pessoa ainda convida', async () => {
    const first = await newGroup(ana, 'Primeiro');
    const second = await newGroup(ana, 'Segundo');
    expect((await invite(ana, first.id, bia)).statusCode).toBe(201);
    expect((await bia.request('POST', `/api/invites/${first.id}/decline`)).statusCode).toBe(204);

    const blocked = await invite(ana, second.id, bia);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.message).toBe('Não é possível convidar essa pessoa agora.');

    const carla = await t.signIn('carla@example.com', { username: 'carla', displayName: 'Carla' });
    const carlas = await newGroup(carla, 'Da Carla');
    expect((await invite(carla, carlas.id, bia)).statusCode).toBe(201);

    time += 30 * 24 * 60 * 60 * 1000 - 1000;
    expect((await invite(ana, second.id, bia)).statusCode).toBe(409);
    time += 2000;
    expect((await invite(ana, second.id, bia)).statusCode).toBe(201);
  });

  it('sair do grupo bloqueia o dono atual; ser removido pelo dono não bloqueia', async () => {
    const group = await newGroup(ana);
    await joinGroup(ana, bia, group.id);
    expect((await bia.request('DELETE', `/api/boards/${group.id}/members/${bia.userId}`)).statusCode).toBe(204);
    expect((await invite(ana, group.id, bia)).statusCode).toBe(409);

    const carla = await t.signIn('carla@example.com', { username: 'carla', displayName: 'Carla' });
    await joinGroup(ana, carla, group.id);
    expect((await ana.request('DELETE', `/api/boards/${group.id}/members/${carla.userId}`)).statusCode).toBe(204);
    expect((await invite(ana, group.id, carla)).statusCode).toBe(201);
  });

  it('o bloqueio fica no banco só com os ids', async () => {
    const group = await newGroup(ana);
    await invite(ana, group.id, bia);
    await bia.request('POST', `/api/invites/${group.id}/decline`);
    expect(t.temp.db.prepare('SELECT invitee_id, inviter_id FROM invite_blocks').all()).toEqual([
      { invitee_id: bia.userId, inviter_id: ana.userId },
    ]);
  });
});

describe('tetos das tarefas e disjuntor de disco', () => {
  async function appWith(taskLimits: Partial<TaskLimits>) {
    await t.close();
    t = await createTestApp({ taskLimits });
    ana = await t.signIn('ana@example.com', { username: 'ana', displayName: 'Ana' });
    bia = await t.signIn('bia@example.com', { username: 'bia', displayName: 'Bia' });
  }

  const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  const count = () => (t.temp.db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n;

  it('tarefas por quadro: passou do teto, 409 e nada é criado', async () => {
    await appWith({ maxTasksPerBoard: 2 });
    for (const title of ['A', 'B']) expect((await ana.request('POST', `/api/boards/${ana.boardId}/tasks`, { title })).statusCode).toBe(201);
    const before = count();
    const res = await ana.request('POST', `/api/boards/${ana.boardId}/tasks`, { title: 'C' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toMatch(/limite de 2 tarefas/);
    expect(count()).toBe(before);
    // Outro quadro tem o próprio teto.
    expect((await bia.request('POST', `/api/boards/${bia.boardId}/tasks`, { title: 'B1' })).statusCode).toBe(201);
  });

  it('conteúdo por quadro: criar ou editar além do teto é desfeito', async () => {
    await appWith({ maxContentBytesPerBoard: 400 });
    const created = await ana.request('POST', `/api/boards/${ana.boardId}/tasks`, { title: 'A', content: doc('curto') });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: number }).id;
    const tooBig = await ana.request('POST', `/api/boards/${ana.boardId}/tasks`, { title: 'B', content: doc('x'.repeat(400)) });
    expect(tooBig.statusCode).toBe(409);
    expect(tooBig.json().error.message).toMatch(/conteúdo das tarefas deste quadro/);
    const edit = await ana.request('PATCH', `/api/tasks/${id}`, { title: 'Novo', content: doc('y'.repeat(400)) });
    expect(edit.statusCode).toBe(409);
    expect(((await ana.request('GET', `/api/tasks/${id}`)).json() as { title: string }).title).toBe('A');
  });

  it('conteúdo por dono: soma o quadro pessoal e os grupos de quem é dono', async () => {
    await appWith({ maxContentBytesPerOwner: 600 });
    const group = await newGroup(ana);
    await joinGroup(ana, bia, group.id);
    expect((await ana.request('POST', `/api/boards/${ana.boardId}/tasks`, { title: 'P', content: doc('a'.repeat(250)) })).statusCode).toBe(201);
    // A Bia escreve no grupo da Ana: conta para a Ana (dona).
    const res = await bia.request('POST', `/api/boards/${group.id}/tasks`, { title: 'G', content: doc('b'.repeat(350)) });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toMatch(/limite de conteúdo/);
    // No quadro pessoal da Bia, nada mudou.
    expect((await bia.request('POST', `/api/boards/${bia.boardId}/tasks`, { title: 'B', content: doc('b'.repeat(350)) })).statusCode).toBe(201);
  });

  it('banco acima do tamanho máximo: criar e editar dão 503; ler e apagar continuam', async () => {
    await appWith({ maxDbBytes: 1 });
    const id = Number(
      t.temp.db
        .prepare(
          `INSERT INTO tasks (board_id, title, color, content, deck_order, created_at, updated_at)
           VALUES (?, 'A', 'azul', '{"type":"doc"}', 0, 'x', 'x')`,
        )
        .run(ana.boardId).lastInsertRowid,
    );
    const blocked = await ana.request('POST', `/api/boards/${ana.boardId}/tasks`, { title: 'B' });
    expect(blocked.statusCode).toBe(503);
    expect(blocked.json().error.code).toBe('STORAGE_FULL');
    expect((await ana.request('PATCH', `/api/tasks/${id}`, { title: 'X' })).statusCode).toBe(503);
    expect((await ana.request('GET', `/api/boards/${ana.boardId}/tasks`)).statusCode).toBe(200);
    expect((await ana.request('DELETE', `/api/tasks/${id}`)).statusCode).toBe(204);
  });
});
