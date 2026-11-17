import type { Task } from '@quadro/shared';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeApi, makeTask } from '../test/fakeApi';
import { createTestQueryClient, createWrapper } from '../test/render';
import { ApiError } from './client';
import {
  CALENDAR_STALE_MS,
  TASKS_KEY,
  createQueryClient,
  useCalendarEvents,
  useCreateTask,
  useDeleteTask,
  useMoveTask,
  useResetBoard,
  useResizeTask,
  useTasks,
  useUpdateTask,
} from './queries';

function setup(initial: Task[] = []) {
  const api = createFakeApi(initial);
  const queryClient = createTestQueryClient();
  const wrapper = createWrapper(api, queryClient);
  const cache = () => queryClient.getQueryData<Task[]>(TASKS_KEY);
  return { api, queryClient, wrapper, cache };
}

describe('createQueryClient', () => {
  it('não repete mutações e tenta a leitura uma vez a mais', () => {
    const defaults = createQueryClient().getDefaultOptions();
    expect(defaults.mutations?.retry).toBe(false);
    expect(defaults.queries?.retry).toBe(1);
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
