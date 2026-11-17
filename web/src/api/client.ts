import {
  CLIENT_HEADER,
  CLIENT_HEADER_VALUE,
  isMondayIsoDate,
  type ApiErrorBody,
  type ApiErrorCode,
  type CalendarWeekResponse,
  type CreateTaskInput,
  type MoveTarget,
  type ResetResponse,
  type Task,
  type TaskListResponse,
  type UpdateTaskInput,
} from '@quadro/shared';

export type ClientErrorCode = ApiErrorCode | 'NETWORK' | 'UNKNOWN';

export interface ApiIssue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ClientErrorCode;
  readonly issues: ApiIssue[];

  constructor(status: number, code: ClientErrorCode, message: string, issues: ApiIssue[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

export interface ApiClient {
  listTasks(): Promise<Task[]>;
  createTask(input: CreateTaskInput): Promise<Task>;
  updateTask(id: number, patch: UpdateTaskInput): Promise<Task>;
  deleteTask(id: number): Promise<void>;
  moveTask(id: number, to: MoveTarget): Promise<Task[]>;
  resetBoard(): Promise<ResetResponse>;
  /** Eventos da agenda da Apple na semana que começa em `mondayIso` (AAAA-MM-DD). */
  listCalendarEvents(mondayIso: string): Promise<CalendarWeekResponse>;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  /** Prefixo das URLs. Padrão: '' (mesma origem; o Vite faz proxy de /api). */
  baseUrl?: string;
  fetch?: FetchLike;
}

export const NETWORK_MESSAGE = 'Não foi possível falar com o servidor. Verifique se a API está rodando.';
export const UNKNOWN_MESSAGE = 'Algo deu errado. Tente novamente.';

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const error = (value as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return typeof code === 'string' && typeof message === 'string';
}

function parseIssues(value: unknown): ApiIssue[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (issue): issue is ApiIssue =>
      typeof issue === 'object' &&
      issue !== null &&
      typeof (issue as ApiIssue).path === 'string' &&
      typeof (issue as ApiIssue).message === 'string',
  );
}

function taskPath(id: number, suffix = ''): string {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ApiError(0, 'VALIDATION', 'Identificador de tarefa inválido');
  }
  return `/api/tasks/${id}${suffix}`;
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const baseUrl = options.baseUrl ?? '';
  const doFetch: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  async function request<T>(method: string, path: string, body?: unknown, clientHeader = false): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    // Toda mutação leva o header do cliente (o guard da API exige); a agenda também, mesmo sendo GET.
    if (clientHeader || (method !== 'GET' && method !== 'HEAD')) headers[CLIENT_HEADER] = CLIENT_HEADER_VALUE;
    const init: RequestInit = { method, headers, credentials: 'same-origin', cache: 'no-store' };
    // Content-Type só com corpo: o Fastify recusa JSON vazio.
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, init);
    } catch {
      throw new ApiError(0, 'NETWORK', NETWORK_MESSAGE);
    }

    if (response.status === 204) return undefined as T;

    let payload: unknown = null;
    try {
      const text = await response.text();
      payload = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      if (isApiErrorBody(payload)) {
        throw new ApiError(
          response.status,
          payload.error.code,
          payload.error.message,
          parseIssues(payload.error.issues),
        );
      }
      throw new ApiError(response.status, 'UNKNOWN', UNKNOWN_MESSAGE);
    }
    if (payload === null) throw new ApiError(response.status, 'UNKNOWN', 'Resposta inválida do servidor');
    return payload as T;
  }

  return {
    async listTasks() {
      return (await request<TaskListResponse>('GET', '/api/tasks')).tasks;
    },
    async createTask(input) {
      return request<Task>('POST', '/api/tasks', input);
    },
    async updateTask(id, patch) {
      return request<Task>('PATCH', taskPath(id), patch);
    },
    async deleteTask(id) {
      await request<void>('DELETE', taskPath(id));
    },
    async moveTask(id, to) {
      return (await request<TaskListResponse>('PUT', taskPath(id, '/position'), { to })).tasks;
    },
    async resetBoard() {
      return request<ResetResponse>('POST', '/api/board/reset');
    },
    async listCalendarEvents(mondayIso) {
      if (!isMondayIsoDate(mondayIso)) throw new ApiError(0, 'VALIDATION', 'Semana inválida');
      const response = await request<CalendarWeekResponse>(
        'GET',
        `/api/calendar/events?week=${encodeURIComponent(mondayIso)}`,
        undefined,
        true,
      );
      return { enabled: response.enabled === true, events: Array.isArray(response.events) ? response.events : [] };
    },
  };
}

/** Mensagem para a interface: "fallback. detalhe" (primeiro problema de validação ou a mensagem da API). */
export function describeError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const detail = error.issues[0]?.message ?? error.message;
    return detail ? `${fallback}. ${detail}` : fallback;
  }
  return fallback;
}
