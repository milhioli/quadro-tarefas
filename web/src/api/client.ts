import {
  CLIENT_HEADER,
  CLIENT_HEADER_VALUE,
  isMondayIsoDate,
  type ApiErrorBody,
  type ApiErrorCode,
  type AuthMethods,
  type BoardListResponse,
  type BoardSummary,
  type CalendarWeekResponse,
  type CreateTaskInput,
  type Invite,
  type InviteListResponse,
  type MeResponse,
  type Member,
  type MemberListResponse,
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

export interface ProfileInput {
  username: string;
  displayName: string;
}

export interface ApiClient {
  // Tarefas: a lista, a criação e o reset são do quadro; o resto vai pelo id da tarefa
  // (o servidor acha o quadro pela própria linha e confere se a pessoa é membro).
  listTasks(boardId: number): Promise<Task[]>;
  createTask(boardId: number, input: CreateTaskInput): Promise<Task>;
  updateTask(id: number, patch: UpdateTaskInput): Promise<Task>;
  deleteTask(id: number): Promise<void>;
  moveTask(id: number, to: MoveTarget): Promise<Task[]>;
  resetBoard(boardId: number): Promise<ResetResponse>;
  /** Eventos da agenda da Apple na semana que começa em `mondayIso` (AAAA-MM-DD). */
  listCalendarEvents(mondayIso: string): Promise<CalendarWeekResponse>;

  // Conta
  getMe(): Promise<MeResponse>;
  getAuthMethods(): Promise<AuthMethods>;
  /** Só existe no servidor de E2E (`npm run dev:e2e`). */
  devLogin(email: string): Promise<MeResponse>;
  logout(): Promise<void>;
  createProfile(input: ProfileInput): Promise<MeResponse>;

  // Quadros, membros e convites
  listBoards(): Promise<BoardSummary[]>;
  createBoard(name: string): Promise<BoardSummary>;
  renameBoard(boardId: number, name: string): Promise<BoardSummary>;
  deleteBoard(boardId: number): Promise<void>;
  listMembers(boardId: number): Promise<Member[]>;
  inviteMember(boardId: number, handle: string): Promise<Member>;
  removeMember(boardId: number, userId: number): Promise<void>;
  listInvites(): Promise<Invite[]>;
  acceptInvite(boardId: number): Promise<BoardSummary>;
  declineInvite(boardId: number): Promise<void>;
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

function checkId(id: number, label: string): number {
  if (!Number.isSafeInteger(id) || id <= 0) throw new ApiError(0, 'VALIDATION', `Identificador ${label} inválido`);
  return id;
}

function taskPath(id: number, suffix = ''): string {
  return `/api/tasks/${checkId(id, 'de tarefa')}${suffix}`;
}

function boardPath(boardId: number, suffix = ''): string {
  return `/api/boards/${checkId(boardId, 'de quadro')}${suffix}`;
}

function invitePath(boardId: number, action: 'accept' | 'decline'): string {
  return `/api/invites/${checkId(boardId, 'de quadro')}/${action}`;
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
    async listTasks(boardId) {
      return (await request<TaskListResponse>('GET', boardPath(boardId, '/tasks'))).tasks;
    },
    async createTask(boardId, input) {
      return request<Task>('POST', boardPath(boardId, '/tasks'), input);
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
    async resetBoard(boardId) {
      return request<ResetResponse>('POST', boardPath(boardId, '/reset'));
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

    async getMe() {
      return request<MeResponse>('GET', '/api/me');
    },
    async getAuthMethods() {
      return request<AuthMethods>('GET', '/api/auth/methods');
    },
    async devLogin(email) {
      return request<MeResponse>('POST', '/api/auth/dev/login', { email });
    },
    async logout() {
      // Sem corpo: o Fastify recusa JSON vazio.
      await request<void>('POST', '/api/auth/logout');
    },
    async createProfile(input) {
      return request<MeResponse>('POST', '/api/me/profile', input);
    },

    async listBoards() {
      return (await request<BoardListResponse>('GET', '/api/boards')).boards;
    },
    async createBoard(name) {
      return request<BoardSummary>('POST', '/api/boards', { name });
    },
    async renameBoard(boardId, name) {
      return request<BoardSummary>('PATCH', boardPath(boardId), { name });
    },
    async deleteBoard(boardId) {
      await request<void>('DELETE', boardPath(boardId));
    },
    async listMembers(boardId) {
      return (await request<MemberListResponse>('GET', boardPath(boardId, '/members'))).members;
    },
    async inviteMember(boardId, handle) {
      return request<Member>('POST', boardPath(boardId, '/invites'), { handle });
    },
    async removeMember(boardId, userId) {
      await request<void>('DELETE', boardPath(boardId, `/members/${checkId(userId, 'de pessoa')}`));
    },
    async listInvites() {
      return (await request<InviteListResponse>('GET', '/api/invites')).invites;
    },
    async acceptInvite(boardId) {
      return request<BoardSummary>('POST', invitePath(boardId, 'accept'));
    },
    async declineInvite(boardId) {
      await request<void>('POST', invitePath(boardId, 'decline'));
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
