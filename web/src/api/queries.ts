import {
  applyPositions,
  planMove,
  type CalendarWeekResponse,
  type CreateTaskInput,
  type MoveTarget,
  type ResetResponse,
  type Task,
  type UpdateTaskInput,
} from '@quadro/shared';
import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from './ApiContext';
import type { ApiError } from './client';

export const TASKS_KEY = ['tasks'] as const;
export const MOVE_KEY = ['tasks', 'move'] as const;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 1, refetchOnWindowFocus: true },
      mutations: { retry: false },
    },
  });
}

export function useTasks() {
  const api = useApi();
  return useQuery<Task[], ApiError>({ queryKey: TASKS_KEY, queryFn: () => api.listTasks() });
}

export function useCreateTask() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<Task, ApiError, CreateTaskInput>({
    mutationFn: (input) => api.createTask(input),
    onSuccess: (task) => {
      queryClient.setQueryData<Task[]>(TASKS_KEY, (old) => [...(old ?? []).filter((t) => t.id !== task.id), task]);
    },
    // Ex.: 409 de horário ocupado — recarrega a ocupação real.
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: TASKS_KEY });
    },
  });
}

export interface UpdateVariables {
  id: number;
  patch: UpdateTaskInput;
}

export function useUpdateTask() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<Task, ApiError, UpdateVariables>({
    mutationFn: ({ id, patch }) => api.updateTask(id, patch),
    onSuccess: (task) => {
      queryClient.setQueryData<Task[]>(TASKS_KEY, (old) => old?.map((t) => (t.id === task.id ? task : t)));
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: TASKS_KEY });
    },
  });
}

export function useDeleteTask() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, number>({
    mutationFn: (id) => api.deleteTask(id),
    onSuccess: (_data, id) => {
      queryClient.setQueryData<Task[]>(TASKS_KEY, (old) => old?.filter((t) => t.id !== id));
    },
  });
}

export interface MoveVariables {
  taskId: number;
  to: MoveTarget;
}

interface MoveSnapshot {
  previous: Task[] | undefined;
}

/**
 * Move otimista: aplica as mesmas regras do servidor (planMove) no cache na
 * hora, desfaz se a API falhar e, no sucesso, grava a lista que o servidor
 * devolveu (fonte da verdade).
 */
export function useMoveTask() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<Task[], ApiError, MoveVariables, MoveSnapshot>({
    mutationKey: MOVE_KEY,
    mutationFn: ({ taskId, to }) => api.moveTask(taskId, to),
    onMutate: async ({ taskId, to }) => {
      await queryClient.cancelQueries({ queryKey: TASKS_KEY });
      const previous = queryClient.getQueryData<Task[]>(TASKS_KEY);
      if (previous) {
        try {
          queryClient.setQueryData<Task[]>(TASKS_KEY, applyPositions(previous, planMove(previous, taskId, to)));
        } catch {
          // Movimento inválido no estado local: o servidor decide.
        }
      }
      return { previous };
    },
    onError: (_error, _variables, snapshot) => {
      if (snapshot?.previous) queryClient.setQueryData<Task[]>(TASKS_KEY, snapshot.previous);
      void queryClient.invalidateQueries({ queryKey: TASKS_KEY });
    },
    onSuccess: (tasks) => {
      queryClient.setQueryData<Task[]>(TASKS_KEY, tasks);
    },
  });
}

export interface ResizeVariables {
  id: number;
  span: number;
}

/**
 * Redimensionar pela borda: o cartão fica no tamanho novo na hora, o PATCH
 * `{span}` vai ao servidor e, se ele recusar (409 com a tarefa de baixo ou
 * 400 além de 22:00), o tamanho volta e a lista é recarregada.
 */
export function useResizeTask() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<Task, ApiError, ResizeVariables, MoveSnapshot>({
    mutationFn: ({ id, span }) => api.updateTask(id, { span }),
    onMutate: async ({ id, span }) => {
      await queryClient.cancelQueries({ queryKey: TASKS_KEY });
      const previous = queryClient.getQueryData<Task[]>(TASKS_KEY);
      queryClient.setQueryData<Task[]>(TASKS_KEY, (old) => old?.map((t) => (t.id === id ? { ...t, span } : t)));
      return { previous };
    },
    onError: (_error, _variables, snapshot) => {
      if (snapshot?.previous) queryClient.setQueryData<Task[]>(TASKS_KEY, snapshot.previous);
      void queryClient.invalidateQueries({ queryKey: TASKS_KEY });
    },
    onSuccess: (task) => {
      queryClient.setQueryData<Task[]>(TASKS_KEY, (old) => old?.map((t) => (t.id === task.id ? task : t)));
    },
  });
}

export const CALENDAR_STALE_MS = 5 * 60_000;
export const calendarKey = (mondayIso: string) => ['calendar', mondayIso] as const;

/** Agenda da Apple da semana. Erro não derruba a tela; sem retry (o servidor já pausa após senha recusada). */
export function useCalendarEvents(mondayIso: string) {
  const api = useApi();
  return useQuery<CalendarWeekResponse, ApiError>({
    queryKey: calendarKey(mondayIso),
    queryFn: () => api.listCalendarEvents(mondayIso),
    staleTime: CALENDAR_STALE_MS,
    retry: false,
  });
}

export function useResetBoard() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<ResetResponse, ApiError, void>({
    mutationFn: () => api.resetBoard(),
    onSuccess: (result) => {
      queryClient.setQueryData<Task[]>(TASKS_KEY, result.tasks);
    },
  });
}
