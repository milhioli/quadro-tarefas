import {
  applyPositions,
  planMove,
  type CalendarWeekResponse,
  type CreateTaskInput,
  type MeResponse,
  type MoveTarget,
  type ResetResponse,
  type Task,
  type UpdateTaskInput,
} from '@quadro/shared';
import { MutationCache, QueryCache, QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from './ApiContext';
import { useBoardId } from './BoardContext';
import { ApiError } from './client';

// ---------- Chaves do cache ----------
// Tudo que é de um quadro começa com ['boards', id]; a lista de quadros é ['boards', 'list'].

export const ME_KEY = ['me'] as const;
export const AUTH_METHODS_KEY = ['auth', 'methods'] as const;
export const BOARDS_KEY = ['boards', 'list'] as const;
export const INVITES_KEY = ['invites'] as const;
export const INFO_KEY = ['info'] as const;
export const ACCOUNTS_KEY = ['admin', 'users'] as const;
export const tasksKey = (boardId: number) => ['boards', boardId, 'tasks'] as const;
export const moveKey = (boardId: number) => ['boards', boardId, 'tasks', 'move'] as const;
export const membersKey = (boardId: number) => ['boards', boardId, 'members'] as const;
export const CALENDAR_STALE_MS = 5 * 60_000;
export const calendarKey = (mondayIso: string) => ['calendar', mondayIso] as const;

/** Sem sessão (ou depois de sair). */
export const LOGGED_OUT: MeResponse = Object.freeze({ user: null, pendingProfile: null });

// ---------- Sessão ----------

/**
 * Troca de sessão (sair, 401, login de desenvolvimento): apaga do cache tudo
 * que era da conta anterior e grava o `me` novo. A troca de conta nunca mostra
 * dados da conta de antes.
 */
export function resetSession(queryClient: QueryClient, me: MeResponse): void {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== ME_KEY[0] });
  queryClient.setQueryData<MeResponse>(ME_KEY, me);
}

/** Erro 4xx não se repete: o servidor já respondeu o que tinha a dizer. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

/**
 * Caches que reagem à sessão: todo 401 volta para a tela de login, com o cache
 * zerado; um 403 NEEDS_USERNAME recarrega o `me` (leva ao primeiro acesso).
 */
export function createSessionCaches(getClient: () => QueryClient) {
  const onError = (error: unknown) => {
    if (!(error instanceof ApiError)) return;
    if (error.status === 401) resetSession(getClient(), LOGGED_OUT);
    else if (error.code === 'NEEDS_USERNAME') void getClient().invalidateQueries({ queryKey: ME_KEY });
  };
  return { queryCache: new QueryCache({ onError }), mutationCache: new MutationCache({ onError }) };
}

export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    ...createSessionCaches(() => client),
    defaultOptions: {
      queries: { retry: shouldRetry, refetchOnWindowFocus: true },
      mutations: { retry: false },
    },
  });
  return client;
}

// ---------- Tarefas do quadro aberto ----------

export function useTasks() {
  const api = useApi();
  const boardId = useBoardId();
  return useQuery<Task[], ApiError>({ queryKey: tasksKey(boardId), queryFn: () => api.listTasks(boardId) });
}

export function useCreateTask() {
  const api = useApi();
  const boardId = useBoardId();
  const queryClient = useQueryClient();
  const key = tasksKey(boardId);
  return useMutation<Task, ApiError, CreateTaskInput>({
    mutationFn: (input) => api.createTask(boardId, input),
    onSuccess: (task) => {
      queryClient.setQueryData<Task[]>(key, (old) => [...(old ?? []).filter((t) => t.id !== task.id), task]);
    },
    // Ex.: 409 de horário ocupado — recarrega a ocupação real.
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: key });
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
  const key = tasksKey(useBoardId());
  return useMutation<Task, ApiError, UpdateVariables>({
    mutationFn: ({ id, patch }) => api.updateTask(id, patch),
    onSuccess: (task) => {
      queryClient.setQueryData<Task[]>(key, (old) => old?.map((t) => (t.id === task.id ? task : t)));
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

export function useDeleteTask() {
  const api = useApi();
  const queryClient = useQueryClient();
  const key = tasksKey(useBoardId());
  return useMutation<void, ApiError, number>({
    mutationFn: (id) => api.deleteTask(id),
    onSuccess: (_data, id) => {
      queryClient.setQueryData<Task[]>(key, (old) => old?.filter((t) => t.id !== id));
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
  const boardId = useBoardId();
  const key = tasksKey(boardId);
  return useMutation<Task[], ApiError, MoveVariables, MoveSnapshot>({
    mutationKey: moveKey(boardId),
    mutationFn: ({ taskId, to }) => api.moveTask(taskId, to),
    onMutate: async ({ taskId, to }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Task[]>(key);
      if (previous) {
        try {
          queryClient.setQueryData<Task[]>(key, applyPositions(previous, planMove(previous, taskId, to)));
        } catch {
          // Movimento inválido no estado local: o servidor decide.
        }
      }
      return { previous };
    },
    onError: (_error, _variables, snapshot) => {
      if (snapshot?.previous) queryClient.setQueryData<Task[]>(key, snapshot.previous);
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onSuccess: (tasks) => {
      queryClient.setQueryData<Task[]>(key, tasks);
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
  const key = tasksKey(useBoardId());
  return useMutation<Task, ApiError, ResizeVariables, MoveSnapshot>({
    mutationFn: ({ id, span }) => api.updateTask(id, { span }),
    onMutate: async ({ id, span }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Task[]>(key);
      queryClient.setQueryData<Task[]>(key, (old) => old?.map((t) => (t.id === id ? { ...t, span } : t)));
      return { previous };
    },
    onError: (_error, _variables, snapshot) => {
      if (snapshot?.previous) queryClient.setQueryData<Task[]>(key, snapshot.previous);
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onSuccess: (task) => {
      queryClient.setQueryData<Task[]>(key, (old) => old?.map((t) => (t.id === task.id ? task : t)));
    },
  });
}

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
  const boardId = useBoardId();
  return useMutation<ResetResponse, ApiError, void>({
    mutationFn: () => api.resetBoard(boardId),
    onSuccess: (result) => {
      queryClient.setQueryData<Task[]>(tasksKey(boardId), result.tasks);
    },
  });
}
