import type { ResetResponse, Task } from '@quadro/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/helpers/testApp';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => t.close());

describe('POST /api/board/reset', () => {
  it('devolve todas as tarefas do quadro ao deck', async () => {
    const ids: number[] = [];
    for (const title of ['A', 'B', 'C']) {
      ids.push(((await t.request('POST', '/api/tasks', { title })).json() as Task).id);
    }
    await t.request('PUT', `/api/tasks/${ids[0]}/position`, { to: { kind: 'cell', day: 4, slot: 33 } });
    await t.request('PUT', `/api/tasks/${ids[1]}/position`, { to: { kind: 'cell', day: 0, slot: 0 } });

    const res = await t.request('POST', '/api/board/reset');
    expect(res.statusCode).toBe(200);
    const body = res.json() as ResetResponse;
    expect(body.moved).toBe(2);
    expect(body.tasks.every((task) => task.day === null && task.slot === null)).toBe(true);
    expect(body.tasks.map((task) => [task.title, task.deckOrder])).toEqual([
      ['C', 2],
      ['B', 3],
      ['A', 4],
    ]);
  });

  it('com quadro vazio não move nada', async () => {
    const res = await t.request('POST', '/api/board/reset');
    expect(res.json()).toEqual({ tasks: [], moved: 0 });
  });

  it('sem o header do cliente é bloqueado', async () => {
    const res = await t.raw({ method: 'POST', url: '/api/board/reset', headers: { host: '127.0.0.1:3001' } });
    expect(res.statusCode).toBe(403);
  });
});
