import type { MeResponse, Task } from '@quadro/shared';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeApi, makeTask } from '../test/fakeApi';
import { createTestQueryClient, createWrapper } from '../test/render';
import { ApiError } from './client';
import {
  CALENDAR_STALE_MS,
  LOGGED_OUT,
  ME_KEY,
  createQueryClient,
  resetSession,
  shouldRetry,
  tasksKey,
  useCalendarEvents,
  useCreateTask,
  useDeleteTask,
  useMoveTask,
  useResetBoard,
  useResizeTask,
  useTasks,
  useUpdateTask,
} from './queries';

function setup(initial: Task[] = [], boardId = 1) {
  const api = createFakeApi(initial);
  const queryClient = createTestQueryClient();
  const wrapper = createWrapper(api, queryClient, boardId);
  const cache = () => queryClient.getQueryData<Task[]>(tasksKey(boardId));
  return { api, queryClient, wrapper, cache };
}

const SIGNED_IN: MeResponse = {
  user: { id: 1, handle: 'admin_00', displayName: 'Admin', role: 'admin', personalBoardId: 1 },
  pendingProfile: null,
};

describe('createQueryClient', () => {
  it('não repete mutações; a leitura tenta uma vez a mais, exceto em erro 4xx', () => {
    const defaults = createQueryClient().getDefaultOptions();
    expect(defaults.mutations?.retry).toBe(false);
    expect(defaults.queries?.retry).toBe(shouldRetry);
  });

  it('shouldRetry: 4xx nunca; rede e 5xx uma vez', () => {
    for (const status of [400, 401, 403, 404, 409]) {
      expect(shouldRetry(0, new ApiError(status, 'VALIDATION', 'x')), String(status)).toBe(false);
    }
    expect(shouldRetry(0, new ApiError(500, 'INTERNAL', 'x'))).toBe(true);
    expect(shouldRetry(0, new ApiError(0, 'NETWORK', 'x'))).toBe(true);
    expect(shouldRetry(1, new ApiError(500, 'INTERNAL', 'x'))).toBe(false);
  });
});

describe('sessão no cache', () => {
  it('resetSession apaga tudo da conta anterior e grava o me novo', () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(ME_KEY, SIGNED_IN);
    queryClient.setQueryData(tasksKey(1), [makeTask({ id: 1, title: 'Segredo da conta anterior' })]);
    queryClient.setQueryData(['calendar', '2026-11-16'], { enabled: true, events: [] });
    resetSession(queryClient, LOGGED_OUT);
    expect(queryClient.getQueryData(ME_KEY)).toEqual(LOGGED_OUT);
    expect(queryClient.getQueryCache().getAll().map((q) => q.queryKey)).toEqual([ME_KEY]);
  });

  it('um 401 em qualquer leitura volta para o login com o cache zerado', async () => {
    const { api, queryClient, wrapper } = setup([makeTask({ id: 1 })]);
    queryClient.setQueryData(ME_KEY, SIGNED_IN);
    api.failNext('listTasks', new ApiError(401, 'UNAUTHENTICATED', 'Entre para continuar'));
    // No app, o Shell troca para a tela de login nesse momento e desmonta o quadro.
    renderHook(() => useTasks(), { wrapper });
    await waitFor(() => expect(queryClient.getQueryData(ME_KEY)).toEqual(LOGGED_OUT));
  });

  it('um 401 numa mutação também', async () => {
    const { api, queryClient, wrapper } = setup([makeTask({ id: 1 })]);
    queryClient.setQueryData(ME_KEY, SIGNED_IN);
    const { result } = renderHook(() => ({ tasks: useTasks(), update: useUpdateTask() }), { wrapper });
    await waitFor(() => expect(result.current.tasks.isSuccess).toBe(true));
    api.failNext('updateTask', new ApiError(401, 'UNAUTHENTICATED', 'Entre para continuar'));
    await act(async () => {
      await result.current.update.mutateAsync({ id: 1, patch: { title: 'x' } }).catch(() => undefined);
    });
    expect(queryClient.getQueryData(ME_KEY)).toEqual(LOGGED_OUT);
  });

  it('NEEDS_USERNAME recarrega o me', async () => {
    const { api, queryClient, wrapper } = setup();
    api.setMe({ user: null, pendingProfile: { suggestedName: 'Ana' } });
    queryClient.setQueryData(ME_KEY, SIGNED_IN);
    api.failNext('listTasks', new ApiError(403, 'NEEDS_USERNAME', 'Escolha um nome de usuário'));
    renderHook(() => useTasks(), { wrapper });
    await waitFor(() => expect(queryClient.getQueryState(ME_KEY)?.isInvalidated).toBe(true));
  });
});

describe('quadro aberto', () => {
  it('as tarefas são lidas e guardadas por quadro', async () => {
    const { api, wrapper, queryClient } = setup([makeTask({ id: 1 }), makeTask({ id: 2, boardId: 5 })], 5);
    const { result } = renderHook(() => useTasks(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((t) => t.id)).toEqual([2]);
    expect(api.calls.find((c) => c.method === 'listTasks')?.args).toEqual([5]);
    expect(queryClient.getQueryData(tasksKey(1))).toBeUndefined();
  });

  it('criar e resetar vão para o quadro aberto', async () => {
    const { api, wrapper, cache } = setup([makeTask({ id: 1, boardId: 5, day: 0, slot: 0 })], 5);
    const { result } = renderHook(() => ({ tasks: useTasks(), create: useCreateTask(), reset: useResetBoard() }), { wrapper });
    await waitFor(() => expect(result.current.tasks.isSuccess).toBe(true));
    await act(() => result.current.create.mutateAsync({ title: 'Nova' }));
    await act(() => result.current.reset.mutateAsync());
    expect(api.calls.filter((c) => c.method === 'createTask').map((c) => c.args[0])).toEqual([5]);
    expect(api.calls.filter((c) => c.method === 'resetBoard').map((c) => c.args)).toEqual([[5]]);
    expect(cache()?.every((t) => t.boardId === 5)).toBe(true);
  });
});

describe('useTasks', () => {
  it('carrega a lista da API', async () => {
    const { wrapper } = setup([makeTask({ id: 1 }), makeTask({ id: 2, day: 0, slot: 0 })]);
    const { result } = renderHook(() => useTasks(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((t) => t.id)).toEqual([1, 2]);
  });
});

describe('mutações de CRUD', () => {
  it('criar acrescenta ao cache', async () => {
    const { wrapper, cache } = setup([makeTask({ id: 1 })]);
    const { result } = renderHook(() => ({ tasks: useTasks(), create: useCreateTask() }), { wrapper });
    await waitFor(() => expect(result.current.tasks.isSuccess).toBe(true));

    await act(() => result.current.create.mutateAsync({ title: 'Nova', color: 'verde' }));
    expect(cache()?.map((t) => [t.id, t.title, t.color])).toEqual([
      [1, 'Tarefa 1', 'amarelo'],
      [2, 'Nova', 'verde'],
    ]);
  });

  it('editar substitui a tarefa no cache', async () => {
    const { wrapper, cache } = setup([makeTask({ id: 1 }), makeTask({ id: 2 })]);
    const { result } = renderHook(() => ({ tasks: useTasks(), update: useUpdateTask() }), { wrapper });
    await waitFor(() => expect(result.current.tasks.isSuccess).toBe(true));

    await act(() => result.current.update.mutateAsync({ id: 2, patch: { title: 'Editada' } }));
    expect(cache()?.map((t) => t.title)).toEqual(['Tarefa 1', 'Editada']);
  });

  it('criar já agendado entra no cache na célula', async () => {
    const { wrapper, cache } = setup();
    const { result } = renderHook(() => ({ tasks: useTasks(), create: useCreateTask() }), { wrapper });
    await waitFor(() => expect(result.current.tasks.isSuccess).toBe(true));

    await act(() => result.current.create.mutateAsync({ title: 'Agendada', position: { kind: 'cell', day: 1, slot: 3 } }));
    expect(cache()?.[0]).toMatchObject({ title: 'Agendada', day: 1, slot: 3, deckOrder: null });
  });

  it('horário ocupado (409) recarrega a lista e não muda o cache', async () => {
    const { api, wrapper, cache } = setup([makeTask({ id: 1, title: 'Ocupante', day: 0, slot: 0 })]);
    const { result } = renderHook(() => ({ tasks: useTasks(), create: useCreateTask(), update: useUpdateTask() }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.tasks.isSuccess).toBe(true));
    const reads = () => api.calls.filter((c) => c.method === 'listTasks').length;
    const before = reads();

    // O erro vem da própria promessa: o estado da mutation chega ao componente de forma assíncrona.
    let caught: unknown;
    await act(async () => {
      caught = await result.current.create
        .mutateAsync({ title: 'Nova', position: { kind: 'cell', day: 0, slot: 0 } })
        .catch((error: unknown) => error);
    });
    expect(caught).toMatchObject({ status: 409, code: 'CONFLICT' });
    await waitFor(() => expect(result.current.create.isError).toBe(true));
    await waitFor(() => expect(reads()).toBe(before + 1));
    expect(cache()?.map((t) => t.title)).toEqual(['Ocupante']);
  });

  it('editar com horário ocupado (409) também recarrega', async () => {
    const { api, wrapper } = setup([makeTask({ id: 1, day: 0, slot: 0 }), makeTask({ id: 2 })]);
    const { result } = renderHook(() => ({ tasks: useTasks(), update: useUpdateTask() }), { wrapper });
    await waitFor(() => expect(result.current.tasks.isSuccess).toBe(true));
    const reads = () => api.calls.filter((c) => c.method === 'listTasks').length;
    const before = reads();

    let caught: unknown;
    await act(async () => {
      caught = await result.current.update
        .mutateAsync({ id: 2, patch: { position: { kind: 'cell', day: 0, slot: 0 } } })
        .catch((error: unknown) => error);
    });
    expect(caught).toMatchObject({ status: 409, code: 'CONFLICT' });
    await waitFor(() => expect(result.current.update.isError).toBe(true));
    await waitFor(() => expect(reads()).toBe(before + 1));
  });

  it('excluir remove do cache', async () => {
    const { wrapper, cache } = setup([makeTask({ id: 1 }), makeTask({ id: 2, day: 1, slot: 1 })]);
    const { result } = renderHook(() => ({ tasks: useTasks(), remove: useDeleteTask() }), { wrapper });
    await waitFor(() => expect(result.current.tasks.isSuccess).toBe(true));

    await act(() => result.current.remove.mutateAsync(2));
    expect(cache()?.map((t) => t.id)).toEqual([1]);
  });
});

describe('useMoveTask', () => {
  it('atualiza o cache na hora e depois grava a resposta do servidor', async () => {
    const { api, wrapper, cache } = setup([makeTask({ id: 1 }), makeTask({ id: 2 })]);
    const { result } = renderHook(() => ({ tasks: useTasks(), move: useMoveTask() }), { wrapper });
    await waitFor(() => expect(result.current.tasks.isSuccess).toBe(true));

    const hold = api.holdNext('moveTask');
    act(() => {
      result.current.move.mutate({ taskId: 1, to: { kind: 'cell', day: 2, slot: 4 } });
    });

    await waitFor(() =>
      expect(cache()?.find((t) => t.id === 1)).toMatchObject({ day: 2, slot: 4, deckOrder: null }),
    );
    // O servidor ainda não aplicou.
    expect(api.tasks.find((t) => t.id === 1)?.day).toBeNull();

    hold.release();
    await waitFor(() => expect(result.current.move.isSuccess).toBe(true));
    expect(cache()).toEqual(api.tasks);
  });

  it('desfaz a mudança otimista quando a API falha', async () => {
    const { api, wrapper, cache } = setup([makeTask({ id: 1 }), makeTask({ id: 2, day: 0, slot: 0 })]);
    const { result } = renderHook(() => ({ tasks: useTasks(), move: useMoveTask() }), { wrapper });
    await waitFor(() => expect(result.current.tasks.isSuccess).toBe(true));
    const before = cache();

    api.failNext('moveTask');
    act(() => {
      result.current.move.mutate({ taskId: 1, to: { kind: 'cell', day: 0, slot: 0 } });
    });

    await waitFor(() => expect(result.current.move.isError).toBe(true));
    await waitFor(() => expect(cache()).toEqual(before));
    expect(result.current.move.error?.message).toBe('Erro interno. Tente novamente.');
  });

  it('troca de células atualiza as duas tarefas', async () => {
    const { wrapper, cache } = setup([makeTask({ id: 1, day: 0, slot: 0 }), makeTask({ id: 2, day: 3, slot: 10 })]);
    const { result } = renderHook(() => ({ tasks: useTasks(), move: useMoveTask() }), { wrapper });
    await waitFor(() => expect(result.current.tasks.isSuccess).toBe(true));

    await act(() => result.current.move.mutateAsync({ taskId: 1, to: { kind: 'cell', day: 3, slot: 10 } }));
    expect(cache()?.find((t) => t.id === 1)).toMatchObject({ day: 3, slot: 10 });
    expect(cache()?.find((t) => t.id === 2)).toMatchObject({ day: 0, slot: 0 });
  });
});

describe('useResizeTask', () => {
  it('muda o span no cache na hora, manda só {span} e grava a resposta', async () => {
    const { api, wrapper, cache } = setup([makeTask({ id: 1, day: 0, slot: 0 }), makeTask({ id: 2, day: 0, slot: 5 })]);
    const { result } = renderHook(() => ({ tasks: useTasks(), resize: useResizeTask() }), { wrapper });
    await waitFor(() => expect(result.current.tasks.isSuccess).toBe(true));

    const hold = api.holdNext('updateTask');
    act(() => {
      result.current.resize.mutate({ id: 1, span: 4 });
    });
    await waitFor(() => expect(cache()?.find((t) => t.id === 1)?.span).toBe(4));
    expect(api.tasks.find((t) => t.id === 1)?.span).toBe(1);

    hold.release();
    await waitFor(() => expect(result.current.resize.isSuccess).toBe(true));
    expect(api.calls.filter((c) => c.method === 'updateTask').map((c) => c.args)).toEqual([[1, { span: 4 }]]);
    expect(cache()).toEqual(api.tasks);
  });

  it('crescer sobre a tarefa de baixo (409) volta o tamanho e recarrega', async () => {
    const { wrapper, cache } = setup([makeTask({ id: 1, day: 0, slot: 0 }), makeTask({ id: 2, day: 0, slot: 2 })]);
    const { result } = renderHook(() => ({ tasks: useTasks(), resize: useResizeTask() }), { wrapper });
    await waitFor(() => expect(result.current.tasks.isSuccess).toBe(true));

    let caught: unknown;
    await act(async () => {
      caught = await result.current.resize.mutateAsync({ id: 1, span: 3 }).catch((error: unknown) => error);
    });
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({ status: 409, code: 'CONFLICT' });
    await waitFor(() => expect(result.current.resize.isError).toBe(true));
    await waitFor(() => expect(cache()?.find((t) => t.id === 1)?.span).toBe(1));
  });
});

describe('useCalendarEvents', () => {
  const event = { id: 'e1', title: 'Dentista', start: '2026-11-17T12:00:00.000Z', end: '2026-11-17T13:00:00.000Z', allDay: false };

  it('carrega a semana pedida', async () => {
    const { api, wrapper } = setup();
    api.setCalendar({ enabled: true, events: [event] });
    const { result } = renderHook(() => useCalendarEvents('2026-11-16'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ enabled: true, events: [event] });
    expect(api.calls.find((c) => c.method === 'listCalendarEvents')?.args).toEqual(['2026-11-16']);
    expect(CALENDAR_STALE_MS).toBe(300_000);
  });

  it('erro fica no estado da query, sem retry', async () => {
    const { api, wrapper } = setup();
    api.failNext('listCalendarEvents', new ApiError(502, 'UPSTREAM_AUTH', 'A Apple recusou a senha de app.'));
    const { result } = renderHook(() => useCalendarEvents('2026-11-16'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.code).toBe('UPSTREAM_AUTH');
    expect(api.calls.filter((c) => c.method === 'listCalendarEvents')).toHaveLength(1);
  });
});

describe('useResetBoard', () => {
  it('grava a lista devolvida pelo reset', async () => {
    const { wrapper, cache } = setup([makeTask({ id: 1, day: 0, slot: 0 }), makeTask({ id: 2 })]);
    const { result } = renderHook(() => ({ tasks: useTasks(), reset: useResetBoard() }), { wrapper });
    await waitFor(() => expect(result.current.tasks.isSuccess).toBe(true));

    const response = await act(() => result.current.reset.mutateAsync());
    expect(response.moved).toBe(1);
    expect(cache()?.every((t) => t.day === null && t.slot === null)).toBe(true);
  });
});
