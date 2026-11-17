import type { Task } from '@quadro/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/helpers/testApp';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => t.close());

async function create(title: string, extra: Record<string, unknown> = {}): Promise<Task> {
  const res = await t.request('POST', '/api/tasks', { title, ...extra });
  expect(res.statusCode).toBe(201);
  return res.json() as Task;
}

describe('rotas de tarefas', () => {
  it('lista vazia no início', async () => {
    const res = await t.request('GET', '/api/tasks');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tasks: [] });
  });

  it('cria, busca, atualiza e apaga', async () => {
    const created = await create('  Estudar  ', { color: 'roxo' });
    expect(created).toMatchObject({ title: 'Estudar', color: 'roxo', deckOrder: 0, createdAt: '2026-11-13T12:00:00.000Z' });

    const got = await t.request('GET', `/api/tasks/${created.id}`);
    expect(got.json()).toEqual(created);

    const content = { type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'passo 1' }] }] }] }] };
    const patched = await t.request('PATCH', `/api/tasks/${created.id}`, { content });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as Task).content).toEqual(content);

    const del = await t.request('DELETE', `/api/tasks/${created.id}`);
    expect(del.statusCode).toBe(204);
    expect(del.body).toBe('');
    expect((await t.request('GET', `/api/tasks/${created.id}`)).statusCode).toBe(404);
    expect((await t.request('DELETE', `/api/tasks/${created.id}`)).statusCode).toBe(404);
  });

  it.each([
    ['título vazio', { title: '' }],
    ['título só com espaços', { title: '   ' }],
    ['título longo demais', { title: 'x'.repeat(121) }],
    ['cor inválida', { title: 'a', color: 'red' }],
    ['nó script no conteúdo', { title: 'a', content: { type: 'doc', content: [{ type: 'script' }] } }],
    ['conteúdo profundo demais', { title: 'a', content: deep(40) }],
    ['chave de posição na criação', { title: 'a', day: 0 }],
  ])('POST rejeita %s com 400', async (_label, body) => {
    const res = await t.request('POST', '/api/tasks', body);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'VALIDATION' } });
    expect((await t.request('GET', '/api/tasks')).json()).toEqual({ tasks: [] });
  });

  it('PATCH rejeita chaves extras e corpo vazio', async () => {
    const task = await create('A');
    for (const body of [{ day: 1 }, {}, { title: 'b', slot: 2 }]) {
      const res = await t.request('PATCH', `/api/tasks/${task.id}`, body);
      expect(res.statusCode).toBe(400);
    }
    expect((await t.request('PATCH', '/api/tasks/999', { title: 'x' })).statusCode).toBe(404);
  });

  it.each(['0', 'abc', '1e2', '-1'])('id inválido "%s" dá 400', async (id) => {
    expect((await t.request('GET', `/api/tasks/${id}`)).statusCode).toBe(400);
  });

  it('JSON malformado dá 400 sem detalhes internos', async () => {
    const res = await t.raw({
      method: 'POST',
      url: '/api/tasks',
      headers: { host: '127.0.0.1:3001', 'x-quadro-client': '1', 'content-type': 'application/json' },
      payload: '{"title":',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: { code: 'VALIDATION', message: 'Requisição inválida' } });
  });

  it('corpo acima de 256 KiB dá 413', async () => {
    const res = await t.request('POST', '/api/tasks', { title: 'a', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(300 * 1024) }] }] } });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
  });

  it('text/plain dá 415', async () => {
    const res = await t.raw({
      method: 'POST',
      url: '/api/tasks',
      headers: { host: '127.0.0.1:3001', 'x-quadro-client': '1', 'content-type': 'text/plain' },
      payload: '{"title":"a"}',
    });
    expect(res.statusCode).toBe(415);
  });

  it('prototype poisoning no corpo dá 400', async () => {
    const res = await t.raw({
      method: 'POST',
      url: '/api/tasks',
      headers: { host: '127.0.0.1:3001', 'x-quadro-client': '1', 'content-type': 'application/json' },
      payload: '{"title":"a","__proto__":{"x":1}}',
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('position em POST e PATCH', () => {
  const list = async () => ((await t.request('GET', '/api/tasks')).json() as { tasks: Task[] }).tasks;

  it('POST com célula livre cria já agendada', async () => {
    const res = await t.request('POST', '/api/tasks', { title: 'Academia', position: { kind: 'cell', day: 1, slot: 4 } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ title: 'Academia', day: 1, slot: 4, deckOrder: null });
  });

  it('POST em célula ocupada dá 409 e não cria a tarefa', async () => {
    await create('A', { position: { kind: 'cell', day: 0, slot: 0 } });
    const res = await t.request('POST', '/api/tasks', { title: 'B', position: { kind: 'cell', day: 0, slot: 0 } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: { code: 'CONFLICT', message: 'Esse horário já está ocupado' } });
    expect((await list()).map((x) => x.title)).toEqual(['A']);
  });

  it('PATCH move para célula livre e para o deck', async () => {
    const a = await create('A');
    let res = await t.request('PATCH', `/api/tasks/${a.id}`, { position: { kind: 'cell', day: 2, slot: 2 } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ day: 2, slot: 2, deckOrder: null });

    res = await t.request('PATCH', `/api/tasks/${a.id}`, { position: { kind: 'deck' } });
    expect(res.json()).toMatchObject({ day: null, slot: null });
  });

  it('PATCH com título e célula ocupada dá 409 e o título não muda', async () => {
    await create('A', { position: { kind: 'cell', day: 3, slot: 3 } });
    const b = await create('B');
    const res = await t.request('PATCH', `/api/tasks/${b.id}`, { title: 'B2', position: { kind: 'cell', day: 3, slot: 3 } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'CONFLICT' } });
    expect((await t.request('GET', `/api/tasks/${b.id}`)).json()).toMatchObject({ title: 'B', day: null });
  });

  it('PATCH com position em tarefa inexistente dá 404', async () => {
    const res = await t.request('PATCH', '/api/tasks/999', { position: { kind: 'deck' } });
    expect(res.statusCode).toBe(404);
  });

  it.each([
    { kind: 'cell', day: 5, slot: 0 },
    { kind: 'cell', day: 0, slot: 1, extra: true },
    { kind: 'deck', slot: 1 },
    'deck',
  ])('position inválida %j dá 400 em POST e PATCH', async (position) => {
    const post = await t.request('POST', '/api/tasks', { title: 'x', position });
    expect(post.statusCode).toBe(400);
    const a = await create('A');
    const patch = await t.request('PATCH', `/api/tasks/${a.id}`, { position });
    expect(patch.statusCode).toBe(400);
  });

  it('o arraste (PUT position) continua trocando em vez de recusar', async () => {
    const a = await create('A', { position: { kind: 'cell', day: 0, slot: 0 } });
    const b = await create('B', { position: { kind: 'cell', day: 1, slot: 1 } });
    const res = await t.request('PUT', `/api/tasks/${a.id}/position`, { to: { kind: 'cell', day: 1, slot: 1 } });
    expect(res.statusCode).toBe(200);
    const tasks = (res.json() as { tasks: Task[] }).tasks;
    expect(tasks.find((x) => x.id === a.id)).toMatchObject({ day: 1, slot: 1 });
    expect(tasks.find((x) => x.id === b.id)).toMatchObject({ day: 0, slot: 0 });
  });
});

describe('PUT /api/tasks/:id/position', () => {
  const move = (id: number, to: unknown) => t.request('PUT', `/api/tasks/${id}/position`, { to });
  const where = (tasks: Task[]) =>
    Object.fromEntries(tasks.map((x) => [x.title, x.day === null ? `deck:${x.deckOrder}` : `${x.day}:${x.slot}`]));

  it('cobre os quatro caminhos de troca e devolve a lista completa', async () => {
    const a = await create('A');
    const b = await create('B');
    const c = await create('C');

    let res = await move(a.id, { kind: 'cell', day: 0, slot: 0 });
    expect(res.statusCode).toBe(200);
    expect(where(res.json().tasks)).toEqual({ A: '0:0', B: 'deck:1', C: 'deck:2' });

    res = await move(b.id, { kind: 'cell', day: 1, slot: 1 });
    res = await move(a.id, { kind: 'cell', day: 1, slot: 1 });
    expect(where(res.json().tasks)).toEqual({ A: '1:1', B: '0:0', C: 'deck:2' });

    res = await move(c.id, { kind: 'cell', day: 1, slot: 1 });
    expect(where(res.json().tasks)).toEqual({ A: 'deck:2', B: '0:0', C: '1:1' });

    res = await move(b.id, { kind: 'deck' });
    expect(where(res.json().tasks)).toEqual({ A: 'deck:2', B: 'deck:3', C: '1:1' });
  });

  it('é idempotente', async () => {
    const a = await create('A');
    const first = await move(a.id, { kind: 'cell', day: 2, slot: 2 });
    const second = await move(a.id, { kind: 'cell', day: 2, slot: 2 });
    expect(second.json()).toEqual(first.json());
  });

  it.each([
    { kind: 'cell', day: 5, slot: 0 },
    { kind: 'cell', day: 0, slot: 34 },
    { kind: 'cell', day: 0 },
    { kind: 'outro' },
  ])('alvo inválido %j dá 400', async (to) => {
    const a = await create('A');
    expect((await move(a.id, to)).statusCode).toBe(400);
  });

  it('tarefa inexistente dá 404', async () => {
    const res = await move(42, { kind: 'deck' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('apagar tarefa posicionada libera a célula', async () => {
    const a = await create('A');
    const b = await create('B');
    await move(a.id, { kind: 'cell', day: 0, slot: 0 });
    await t.request('DELETE', `/api/tasks/${a.id}`);
    const res = await move(b.id, { kind: 'cell', day: 0, slot: 0 });
    expect(where(res.json().tasks)).toEqual({ B: '0:0' });
  });
});

function deep(levels: number): unknown {
  let node: Record<string, unknown> = { type: 'paragraph' };
  for (let i = 0; i < levels; i++) node = { type: 'blockquote', content: [node] };
  return { type: 'doc', content: [node] };
}
