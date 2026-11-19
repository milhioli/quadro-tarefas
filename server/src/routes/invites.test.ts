import type { BoardSummary, InviteListResponse } from '@quadro/shared';
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

async function inviteBia(): Promise<number> {
  const group = (await ana.request('POST', '/api/boards', { name: 'Equipe' })).json() as BoardSummary;
  await ana.request('POST', `/api/boards/${group.id}/invites`, { handle: bia.handle });
  return group.id;
}

describe('convites recebidos', () => {
  it('mostra só o nome do quadro e quem convidou', async () => {
    const boardId = await inviteBia();
    const invites = (await bia.request('GET', '/api/invites')).json() as InviteListResponse;
    expect(invites).toEqual({ invites: [{ boardId, boardName: 'Equipe', invitedBy: 'ana_01' }] });
    expect(((await ana.request('GET', '/api/invites')).json() as InviteListResponse).invites).toEqual([]);
  });

  it('aceitar põe o grupo na lista de quadros; aceitar de novo dá 404', async () => {
    const boardId = await inviteBia();
    const res = await bia.request('POST', `/api/invites/${boardId}/accept`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: boardId, name: 'Equipe', kind: 'group', role: 'editor' });
    expect((await bia.request('POST', `/api/invites/${boardId}/accept`)).statusCode).toBe(404);
    expect(((await bia.request('GET', '/api/invites')).json() as InviteListResponse).invites).toEqual([]);
  });

  it('recusar apaga o convite e não dá acesso', async () => {
    const boardId = await inviteBia();
    expect((await bia.request('POST', `/api/invites/${boardId}/decline`)).statusCode).toBe(204);
    expect((await bia.request('GET', `/api/boards/${boardId}/tasks`)).statusCode).toBe(404);
    expect((await bia.request('POST', `/api/invites/${boardId}/accept`)).statusCode).toBe(404);
  });

  it('não dá para aceitar convite que não existe, nem o de outra pessoa', async () => {
    const boardId = await inviteBia();
    const carla = await t.signIn('carla@example.com', { username: 'carla', displayName: 'Carla' });
    expect((await carla.request('POST', `/api/invites/${boardId}/accept`)).statusCode).toBe(404);
    expect((await carla.request('POST', '/api/invites/99999/decline')).statusCode).toBe(404);
  });

  it('aceitar e recusar vão sem corpo e exigem o header do cliente', async () => {
    const boardId = await inviteBia();
    const raw = await t.raw({
      method: 'POST',
      url: `/api/invites/${boardId}/accept`,
      headers: { host: '127.0.0.1:3001', origin: 'http://127.0.0.1:5173', cookie: bia.cookie },
    });
    expect(raw.statusCode).toBe(403);
  });
});
