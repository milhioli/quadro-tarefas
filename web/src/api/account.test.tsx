import type { BoardSummary } from '@quadro/shared';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FAKE_ADMIN_ACCOUNT, FAKE_INFO, FAKE_ME, PERSONAL_BOARD, createFakeApi, makeTask } from '../test/fakeApi';
import { createTestQueryClient, createWrapper } from '../test/render';
import {
  useAcceptInvite,
  useAccounts,
  useBoards,
  useCreateBoard,
  useCreateProfile,
  useDeclineInvite,
  useDeleteAccount,
  useDeleteBoard,
  useDeleteDisabledAccount,
  useDevLogin,
  useInfo,
  useInviteMember,
  useInvites,
  useLeaveBoard,
  useLogout,
  useMe,
  useMembers,
  useRemoveMember,
  useRenameBoard,
  useSetAccountStatus,
} from './account';
import { ACCOUNTS_KEY, BOARDS_KEY, INVITES_KEY, LOGGED_OUT, ME_KEY, membersKey, tasksKey } from './queries';

const GROUP: BoardSummary = { id: 9, name: 'Equipe', kind: 'group', role: 'owner' };

function setup() {
  const api = createFakeApi();
  const queryClient = createTestQueryClient();
  const wrapper = createWrapper(api, queryClient, null);
  return { api, queryClient, wrapper };
}

describe('sessão', () => {
  it('useMe lê o /api/me', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useMe(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(FAKE_ME));
  });

  it('sair apaga tudo da conta no cache e chama o aviso de saída', async () => {
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(ME_KEY, FAKE_ME);
    queryClient.setQueryData(tasksKey(1), [makeTask({ id: 1, title: 'Da conta anterior' })]);
    const onLoggedOut = vi.fn();
    const { result } = renderHook(() => useLogout(onLoggedOut), { wrapper });
    await act(() => result.current.mutateAsync());
    expect(onLoggedOut).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(ME_KEY)).toEqual(LOGGED_OUT);
    expect(queryClient.getQueryData(tasksKey(1))).toBeUndefined();
  });

  it('o login de desenvolvimento também zera o cache: é outra conta', async () => {
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(tasksKey(1), [makeTask({ id: 1 })]);
    const { result } = renderHook(() => useDevLogin(), { wrapper });
    await act(() => result.current.mutateAsync('bia@example.com'));
    expect(queryClient.getQueryData(ME_KEY)).toEqual({ user: null, pendingProfile: { suggestedName: 'bia' } });
    expect(queryClient.getQueryData(tasksKey(1))).toBeUndefined();
  });

  it('criar o perfil grava o me com o handle', async () => {
    const { api, queryClient, wrapper } = setup();
    api.setMe({ user: null, pendingProfile: { suggestedName: 'Ana' } });
    const { result } = renderHook(() => useCreateProfile(), { wrapper });
    await act(() => result.current.mutateAsync({ username: 'ana', displayName: 'Ana' }));
    expect(queryClient.getQueryData<typeof FAKE_ME>(ME_KEY)?.user).toMatchObject({ handle: 'ana_01', displayName: 'Ana' });
  });
});

describe('quadros', () => {
  it('criar acrescenta o grupo à lista; renomear troca o nome', async () => {
    const { wrapper, queryClient } = setup();
    const { result } = renderHook(() => ({ boards: useBoards(), create: useCreateBoard() }), { wrapper });
    await waitFor(() => expect(result.current.boards.data).toEqual([PERSONAL_BOARD]));
    const created = await act(() => result.current.create.mutateAsync('Equipe'));
    expect(created).toMatchObject({ name: 'Equipe', kind: 'group', role: 'owner' });

    const rename = renderHook(() => useRenameBoard(created.id), { wrapper });
    await act(() => rename.result.current.mutateAsync('Time'));
    expect(queryClient.getQueryData<BoardSummary[]>(BOARDS_KEY)?.map((b) => b.name)).toEqual(['Meu quadro', 'Time']);
  });

  it('apagar tira o grupo da lista e as tarefas e membros dele do cache', async () => {
    const { api, wrapper, queryClient } = setup();
    api.setBoards([PERSONAL_BOARD, GROUP]);
    queryClient.setQueryData(BOARDS_KEY, [PERSONAL_BOARD, GROUP]);
    queryClient.setQueryData(tasksKey(9), [makeTask({ id: 3, boardId: 9 })]);
    queryClient.setQueryData(membersKey(9), []);
    queryClient.setQueryData(tasksKey(1), [makeTask({ id: 1 })]);
    const { result } = renderHook(() => useDeleteBoard(9), { wrapper });
    await act(() => result.current.mutateAsync());
    expect(queryClient.getQueryData(BOARDS_KEY)).toEqual([PERSONAL_BOARD]);
    expect(queryClient.getQueryData(tasksKey(9))).toBeUndefined();
    expect(queryClient.getQueryData(membersKey(9))).toBeUndefined();
    expect(queryClient.getQueryData(tasksKey(1))).toHaveLength(1);
  });
});

describe('membros', () => {
  it('convidar acrescenta o convite pendente; remover tira da lista', async () => {
    const { api, wrapper, queryClient } = setup();
    api.setBoards([PERSONAL_BOARD, GROUP]);
    api.setMembers(9, []);
    api.addPerson({ userId: 4, handle: 'bia_02', displayName: 'Bia' });
    const { result } = renderHook(() => ({ members: useMembers(9), invite: useInviteMember(9), remove: useRemoveMember(9) }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.members.data).toEqual([]));
    await act(() => result.current.invite.mutateAsync('bia_02'));
    expect(queryClient.getQueryData(membersKey(9))).toEqual([
      { userId: 4, handle: 'bia_02', displayName: 'Bia', role: 'editor', status: 'invited' },
    ]);
    await act(() => result.current.remove.mutateAsync(4));
    expect(queryClient.getQueryData(membersKey(9))).toEqual([]);
  });

  it('sair do grupo tira o grupo da lista', async () => {
    const { api, wrapper, queryClient } = setup();
    const editorOf = { ...GROUP, role: 'editor' as const };
    api.setBoards([PERSONAL_BOARD, editorOf]);
    queryClient.setQueryData(BOARDS_KEY, [PERSONAL_BOARD, editorOf]);
    const { result } = renderHook(() => useLeaveBoard(9, 1), { wrapper });
    await act(() => result.current.mutateAsync());
    expect(queryClient.getQueryData(BOARDS_KEY)).toEqual([PERSONAL_BOARD]);
  });
});

describe('convites recebidos', () => {
  it('aceitar move o convite para a lista de quadros; recusar só tira o convite', async () => {
    const { api, wrapper, queryClient } = setup();
    api.setInvites([
      { boardId: 9, boardName: 'Equipe', invitedBy: 'ana_01' },
      { boardId: 10, boardName: 'Outro', invitedBy: null },
    ]);
    const { result } = renderHook(
      () => ({ invites: useInvites(), boards: useBoards(), accept: useAcceptInvite(), decline: useDeclineInvite() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.invites.data).toHaveLength(2));
    await waitFor(() => expect(result.current.boards.data).toHaveLength(1));
    await act(() => result.current.accept.mutateAsync(9));
    await act(() => result.current.decline.mutateAsync(10));
    expect(queryClient.getQueryData(INVITES_KEY)).toEqual([]);
    expect(queryClient.getQueryData<BoardSummary[]>(BOARDS_KEY)?.map((b) => [b.id, b.role])).toEqual([
      [1, 'owner'],
      [9, 'editor'],
    ]);
  });
});

describe('conta: informação pública e apagar a conta', () => {
  it('useInfo lê o contato e o responsável', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useInfo(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(FAKE_INFO));
  });

  it('apagar a conta zera o cache, grava o me sem sessão e chama o aviso', async () => {
    const { api, queryClient, wrapper } = setup();
    api.setMe({ ...FAKE_ME, user: { ...FAKE_ME.user!, role: 'user' } });
    queryClient.setQueryData(tasksKey(1), [makeTask({ id: 1, title: 'Da conta apagada' })]);
    const onDeleted = vi.fn();
    const { result } = renderHook(() => useDeleteAccount(onDeleted), { wrapper });
    await act(() => result.current.mutateAsync());
    expect(onDeleted).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(ME_KEY)).toEqual(LOGGED_OUT);
    expect(queryClient.getQueryData(tasksKey(1))).toBeUndefined();
  });

  it('se o servidor recusar, nada muda no cache', async () => {
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(ME_KEY, FAKE_ME);
    const onDeleted = vi.fn();
    const { result } = renderHook(() => useDeleteAccount(onDeleted), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toMatchObject({ status: 409 });
    });
    expect(onDeleted).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(ME_KEY)).toEqual(FAKE_ME);
  });
});

describe('admin: contas', () => {
  const BIA = { id: 4, handle: 'bia_02', email: 'bia@example.com', status: 'active' as const, lastSeenAt: '2026-11-19T12:00:00.000Z' };

  it('lista as contas; desativar troca o status da linha; apagar tira da lista', async () => {
    const { api, queryClient, wrapper } = setup();
    api.setAccounts([FAKE_ADMIN_ACCOUNT, BIA]);
    const { result } = renderHook(
      () => ({ list: useAccounts(), status: useSetAccountStatus(), remove: useDeleteDisabledAccount() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data).toHaveLength(2));
    await act(() => result.current.status.mutateAsync({ userId: 4, status: 'disabled' }));
    expect(queryClient.getQueryData<typeof BIA[]>(ACCOUNTS_KEY)?.find((a) => a.id === 4)?.status).toBe('disabled');
    await act(() => result.current.remove.mutateAsync(4));
    expect(queryClient.getQueryData<typeof BIA[]>(ACCOUNTS_KEY)?.map((a) => a.id)).toEqual([1]);
  });

  it('quem não é admin recebe 404 da lista', async () => {
    const { api, wrapper } = setup();
    api.setMe({ ...FAKE_ME, user: { ...FAKE_ME.user!, role: 'user' } });
    const { result } = renderHook(() => useAccounts(), { wrapper });
    await waitFor(() => expect(result.current.error?.status).toBe(404));
  });
});
