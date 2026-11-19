import {
  DEFAULT_COLOR,
  MoveError,
  applyPositions,
  boardNameSchema,
  emptyDoc,
  formatHandle,
  nextDeckOrder,
  parseHandle,
  planMove,
  planPlacement,
  planReset,
  profileInputSchema,
  type AdminUser,
  type AuthMethods,
  type BoardSummary,
  type CalendarWeekResponse,
  type Invite,
  type MeResponse,
  type MeUser,
  type Member,
  type PublicInfo,
  type Task,
} from '@quadro/shared';
import { ApiError, type ApiClient } from '../api/client';

/** O pedaço do zod que a fake usa (o web não depende do zod direto, só pelo @quadro/shared). */
interface Schema<T> {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } };
}

/**
 * API em memória para testes de componente, com as mesmas regras de posição
 * do servidor (planMove/planReset do @quadro/shared) aplicadas a cada quadro.
 * Não substitui os testes de integração da API, que rodam contra SQLite real
 * (inclusive o controle de acesso por quadro, que aqui não é simulado).
 */

export const T0 = '2026-11-13T12:00:00.000Z';

/** Quem está logado por padrão: o admin, dono do quadro pessoal 1. */
export const FAKE_USER: MeUser = Object.freeze({
  id: 1,
  handle: 'admin_00',
  displayName: 'Admin',
  role: 'admin',
  personalBoardId: 1,
});
export const FAKE_ME: MeResponse = Object.freeze({ user: FAKE_USER, pendingProfile: null });
export const PERSONAL_BOARD: BoardSummary = Object.freeze({ id: 1, name: 'Meu quadro', kind: 'personal', role: 'owner' });
export const FAKE_INFO: PublicInfo = Object.freeze({ contactEmail: 'contato@example.com', operatorName: 'Operador de Teste' });
/** A linha do próprio admin na tela "Contas". */
export const FAKE_ADMIN_ACCOUNT: AdminUser = Object.freeze({
  id: 1,
  handle: 'admin_00',
  email: 'admin@example.com',
  status: 'active',
  lastSeenAt: T0,
});

export function makeTask(overrides: Partial<Task> & { id: number }): Task {
  const placed = overrides.day !== undefined && overrides.day !== null;
  return {
    title: `Tarefa ${overrides.id}`,
    color: DEFAULT_COLOR,
    content: emptyDoc(),
    day: null,
    slot: null,
    span: 1,
    deckOrder: placed ? null : overrides.id,
    boardId: 1,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

export type ApiMethod = keyof ApiClient;

/** Uma conta que existe no "servidor" e pode ser convidada. */
export interface FakePerson {
  userId: number;
  handle: string;
  displayName: string;
}

export interface FakeApi extends ApiClient {
  /** Estado atual das tarefas de todos os quadros (cópia), na ordem do servidor. */
  readonly tasks: Task[];
  readonly calls: Array<{ method: ApiMethod; args: unknown[] }>;
  /** A próxima chamada do método falha com `error`. */
  failNext(method: ApiMethod, error?: ApiError): void;
  /** A próxima chamada do método fica pendente até `release()`. */
  holdNext(method: ApiMethod): { release: () => void };
  /** O que a "agenda da Apple" devolve (padrão: desligada). */
  setCalendar(response: CalendarWeekResponse): void;
  /** Quem está na sessão (padrão: FAKE_ME). */
  setMe(me: MeResponse): void;
  setMethods(methods: AuthMethods): void;
  /** Quadros que a pessoa vê (padrão: só o pessoal). */
  setBoards(boards: BoardSummary[]): void;
  setMembers(boardId: number, members: Member[]): void;
  setInvites(invites: Invite[]): void;
  /** Conta que pode ser convidada pelo handle. */
  addPerson(person: FakePerson): void;
  /** O que `GET /api/info` devolve (padrão: FAKE_INFO). */
  setInfo(info: PublicInfo): void;
  /** As contas da tela do admin (padrão: só a do admin). */
  setAccounts(accounts: AdminUser[]): void;
}

function serverOrder(tasks: readonly Task[]): Task[] {
  const onDeck = (t: Task) => t.day === null || t.slot === null;
  return [...tasks].sort((a, b) => {
    if (a.boardId !== b.boardId) return a.boardId - b.boardId;
    if (onDeck(a) !== onDeck(b)) return onDeck(a) ? -1 : 1;
    if (onDeck(a)) return (a.deckOrder ?? 0) - (b.deckOrder ?? 0) || a.id - b.id;
    return (a.day ?? 0) - (b.day ?? 0) || (a.slot ?? 0) - (b.slot ?? 0) || a.id - b.id;
  });
}

export function createFakeApi(initial: readonly Task[] = []): FakeApi {
  let tasks: Task[] = structuredClone([...initial]);
  let nextId = tasks.reduce((max, task) => Math.max(max, task.id), 0) + 1;
  const calls: Array<{ method: ApiMethod; args: unknown[] }> = [];
  const failures = new Map<ApiMethod, ApiError>();
  const holds = new Map<ApiMethod, Promise<void>>();
  let calendar: CalendarWeekResponse = { enabled: false, events: [] };

  let me: MeResponse = structuredClone(FAKE_ME);
  let methods: AuthMethods = { google: true, dev: false };
  let boards: BoardSummary[] = [structuredClone(PERSONAL_BOARD)];
  const members = new Map<number, Member[]>();
  let invites: Invite[] = [];
  const people: FakePerson[] = [];
  let nextBoardId = 100;
  let nextSeq = 1;
  let info: PublicInfo = structuredClone(FAKE_INFO);
  let accounts: AdminUser[] = [structuredClone(FAKE_ADMIN_ACCOUNT)];

  /** Como o servidor: para quem não é admin, a rota "não existe". */
  function requireAdmin(): MeUser {
    const user = signedIn();
    if (user.role !== 'admin') throw new ApiError(404, 'NOT_FOUND', 'Rota não encontrada');
    return user;
  }

  function otherAccount(userId: number): AdminUser {
    const user = requireAdmin();
    if (userId === user.id) throw new ApiError(409, 'CONFLICT', 'Você não pode mudar o status da própria conta');
    const account = accounts.find((a) => a.id === userId);
    if (!account) throw new ApiError(404, 'NOT_FOUND', 'Conta não encontrada');
    return account;
  }

  const copy = <T>(value: T): T => structuredClone(value);
  const notFound = (message = 'Tarefa não encontrada') => new ApiError(404, 'NOT_FOUND', message);
  const boardNotFound = () => notFound('Quadro não encontrado');

  /** Mesmo mapeamento do servidor (routes/tasks.ts → moveErrorToHttp). */
  function toApiError(error: unknown): unknown {
    if (!(error instanceof MoveError)) return error;
    if (error.code === 'NOT_FOUND') return notFound();
    if (error.code === 'OCCUPIED') return new ApiError(409, 'CONFLICT', 'Esse horário já está ocupado');
    return new ApiError(400, 'VALIDATION', error.message);
  }

  function validate<T>(schema: Schema<T>, value: unknown): T {
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
    const issues = parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message }));
    throw new ApiError(400, 'VALIDATION', 'Dados inválidos', issues);
  }

  const ofBoard = (boardId: number) => tasks.filter((t) => t.boardId === boardId);
  const withBoard = (boardId: number, list: Task[]) => [...tasks.filter((t) => t.boardId !== boardId), ...list];

  /** Aplica `position` como POST/PATCH: célula ocupada é recusada, sem gravar nada. */
  function place(list: Task[], id: number, position: Parameters<typeof planPlacement>[2] | undefined): Task[] {
    if (!position) return list;
    try {
      return applyPositions(list, planPlacement(list, id, position));
    } catch (error) {
      throw toApiError(error);
    }
  }

  async function enter(method: ApiMethod, args: unknown[]): Promise<void> {
    calls.push({ method, args: copy(args) });
    const hold = holds.get(method);
    if (hold) {
      holds.delete(method);
      await hold;
    }
    const failure = failures.get(method);
    if (failure) {
      failures.delete(method);
      throw failure;
    }
  }

  function find(id: number): Task {
    const task = tasks.find((t) => t.id === id);
    if (!task) throw notFound();
    return task;
  }

  function signedIn(): MeUser {
    if (!me.user) throw new ApiError(401, 'UNAUTHENTICATED', 'Entre para continuar');
    return me.user;
  }

  function myBoard(boardId: number, role?: 'owner'): BoardSummary {
    signedIn();
    const board = boards.find((b) => b.id === boardId);
    if (!board) throw boardNotFound();
    if (role === 'owner' && board.role !== 'owner') throw new ApiError(403, 'FORBIDDEN', 'Acesso negado');
    return board;
  }

  return {
    get tasks() {
      return copy(serverOrder(tasks));
    },
    calls,

    failNext(method, error = new ApiError(500, 'INTERNAL', 'Erro interno. Tente novamente.')) {
      failures.set(method, error);
    },

    holdNext(method) {
      let release: () => void = () => {};
      holds.set(
        method,
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      return { release: () => release() };
    },

    setCalendar(response) {
      calendar = copy(response);
    },
    setMe(next) {
      me = copy(next);
    },
    setMethods(next) {
      methods = copy(next);
    },
    setBoards(next) {
      boards = copy(next);
    },
    setMembers(boardId, list) {
      members.set(boardId, copy(list));
    },
    setInvites(next) {
      invites = copy(next);
    },
    addPerson(person) {
      people.push(copy(person));
    },
    setInfo(next) {
      info = copy(next);
    },
    setAccounts(next) {
      accounts = copy(next);
    },

    // ---------- Tarefas ----------

    async listTasks(boardId) {
      await enter('listTasks', [boardId]);
      return copy(serverOrder(ofBoard(boardId)));
    },

    async createTask(boardId, input) {
      await enter('createTask', [boardId, input]);
      const board = ofBoard(boardId);
      const task: Task = {
        id: nextId++,
        title: input.title.trim(),
        color: input.color ?? DEFAULT_COLOR,
        content: input.content ?? emptyDoc(),
        day: null,
        slot: null,
        span: input.span ?? 1,
        deckOrder: nextDeckOrder(board),
        boardId,
        createdAt: T0,
        updatedAt: T0,
      };
      // Calcula tudo antes de gravar: em conflito, nada muda (como a transação do servidor).
      tasks = withBoard(boardId, place([...board, task], task.id, input.position));
      return copy(find(task.id));
    },

    async updateTask(id, patch) {
      await enter('updateTask', [id, patch]);
      const current = find(id);
      const updated: Task = {
        ...current,
        title: patch.title ?? current.title,
        color: patch.color ?? current.color,
        content: patch.content ?? current.content,
        span: patch.span ?? current.span,
      };
      // Como o repositório: span que muda sem `position` é validado na própria célula.
      const keepCell =
        patch.span !== undefined && current.day !== null && current.slot !== null
          ? ({ kind: 'cell', day: current.day, slot: current.slot } as const)
          : undefined;
      const board = ofBoard(current.boardId).map((t) => (t.id === id ? updated : t));
      tasks = withBoard(current.boardId, place(board, id, patch.position ?? keepCell));
      return copy(find(id));
    },

    async deleteTask(id) {
      await enter('deleteTask', [id]);
      find(id);
      tasks = tasks.filter((t) => t.id !== id);
    },

    async moveTask(id, to) {
      await enter('moveTask', [id, to]);
      const { boardId } = find(id);
      const board = ofBoard(boardId);
      try {
        tasks = withBoard(boardId, applyPositions(board, planMove(board, id, to)));
      } catch (error) {
        throw toApiError(error);
      }
      return copy(serverOrder(ofBoard(boardId)));
    },

    async resetBoard(boardId) {
      await enter('resetBoard', [boardId]);
      const board = ofBoard(boardId);
      const changes = planReset(board);
      tasks = withBoard(boardId, applyPositions(board, changes));
      return { tasks: copy(serverOrder(ofBoard(boardId))), moved: changes.length };
    },

    async listCalendarEvents(mondayIso) {
      await enter('listCalendarEvents', [mondayIso]);
      return copy(calendar);
    },

    // ---------- Conta ----------

    async getMe() {
      await enter('getMe', []);
      return copy(me);
    },

    async getAuthMethods() {
      await enter('getAuthMethods', []);
      return copy(methods);
    },

    async devLogin(email) {
      await enter('devLogin', [email]);
      me = { user: null, pendingProfile: { suggestedName: email.split('@')[0] ?? '' } };
      return copy(me);
    },

    async logout() {
      await enter('logout', []);
      me = { user: null, pendingProfile: null };
    },

    async getInfo() {
      await enter('getInfo', []);
      return copy(info);
    },

    async deleteAccount() {
      await enter('deleteAccount', []);
      const user = me.user;
      if (!user && !me.pendingProfile) throw new ApiError(401, 'UNAUTHENTICATED', 'Entre para continuar');
      if (user?.role === 'admin') {
        throw new ApiError(409, 'CONFLICT', 'A conta de administrador não pode ser apagada pelo app.');
      }
      me = { user: null, pendingProfile: null };
      boards = [];
      tasks = [];
    },

    async listAccounts() {
      await enter('listAccounts', []);
      requireAdmin();
      return copy(accounts);
    },

    async setAccountStatus(userId, status) {
      await enter('setAccountStatus', [userId, status]);
      const account = otherAccount(userId);
      accounts = accounts.map((a) => (a.id === account.id ? { ...a, status } : a));
    },

    async deleteDisabledAccount(userId) {
      await enter('deleteDisabledAccount', [userId]);
      const account = otherAccount(userId);
      if (account.status !== 'disabled') throw new ApiError(409, 'CONFLICT', 'Desative a conta antes de apagar');
      accounts = accounts.filter((a) => a.id !== account.id);
    },

    async createProfile(input) {
      await enter('createProfile', [input]);
      if (me.user) throw new ApiError(409, 'CONFLICT', 'O perfil já foi criado');
      if (!me.pendingProfile) throw new ApiError(401, 'UNAUTHENTICATED', 'Entre para continuar');
      const profile = validate(profileInputSchema, input);
      const personal: BoardSummary = { id: nextBoardId++, name: 'Meu quadro', kind: 'personal', role: 'owner' };
      me = {
        user: {
          id: 50 + nextSeq,
          handle: formatHandle(profile.username, nextSeq++),
          displayName: profile.displayName,
          role: 'user',
          personalBoardId: personal.id,
        },
        pendingProfile: null,
      };
      boards = [personal];
      return copy(me);
    },

    // ---------- Quadros, membros e convites ----------

    async listBoards() {
      await enter('listBoards', []);
      signedIn();
      return copy(boards);
    },

    async createBoard(name) {
      await enter('createBoard', [name]);
      const user = signedIn();
      const board: BoardSummary = { id: nextBoardId++, name: validate(boardNameSchema, name), kind: 'group', role: 'owner' };
      boards = [...boards, board];
      members.set(board.id, [
        { userId: user.id, handle: user.handle, displayName: user.displayName, role: 'owner', status: 'active' },
      ]);
      return copy(board);
    },

    async renameBoard(boardId, name) {
      await enter('renameBoard', [boardId, name]);
      const board = myBoard(boardId, 'owner');
      const renamed = { ...board, name: validate(boardNameSchema, name) };
      boards = boards.map((b) => (b.id === boardId ? renamed : b));
      return copy(renamed);
    },

    async deleteBoard(boardId) {
      await enter('deleteBoard', [boardId]);
      const board = myBoard(boardId, 'owner');
      if (board.kind === 'personal') throw new ApiError(400, 'VALIDATION', 'O quadro pessoal não pode ser apagado');
      boards = boards.filter((b) => b.id !== boardId);
      members.delete(boardId);
      tasks = tasks.filter((t) => t.boardId !== boardId);
    },

    async listMembers(boardId) {
      await enter('listMembers', [boardId]);
      myBoard(boardId);
      return copy(members.get(boardId) ?? []);
    },

    async inviteMember(boardId, handle) {
      await enter('inviteMember', [boardId, handle]);
      const board = myBoard(boardId, 'owner');
      if (board.kind !== 'group') throw new ApiError(400, 'VALIDATION', 'O quadro pessoal não aceita membros');
      const parsed = parseHandle(handle);
      if (!parsed) {
        throw new ApiError(400, 'VALIDATION', 'Dados inválidos', [
          { path: 'handle', message: 'Use o nome de usuário com o número (ex.: ana_07)' },
        ]);
      }
      const canonical = formatHandle(parsed.username, parsed.seq);
      const person = people.find((p) => p.handle === canonical);
      if (!person) throw notFound('Nenhuma conta com esse nome de usuário');
      const list = members.get(boardId) ?? [];
      if (list.some((m) => m.userId === person.userId)) {
        throw new ApiError(409, 'CONFLICT', 'Essa pessoa já está no quadro ou já foi convidada');
      }
      const member: Member = { ...person, role: 'editor', status: 'invited' };
      members.set(boardId, [...list, member]);
      return copy(member);
    },

    async removeMember(boardId, userId) {
      await enter('removeMember', [boardId, userId]);
      const user = signedIn();
      const board = myBoard(boardId);
      const list = members.get(boardId) ?? [];
      if (userId === user.id) {
        if (board.role === 'owner') {
          throw new ApiError(409, 'CONFLICT', 'O dono não pode sair do quadro. Apague o grupo se ele não for mais usado.');
        }
        members.set(
          boardId,
          list.filter((m) => m.userId !== userId),
        );
        boards = boards.filter((b) => b.id !== boardId);
        return;
      }
      if (board.role !== 'owner') throw new ApiError(403, 'FORBIDDEN', 'Acesso negado');
      if (!list.some((m) => m.userId === userId)) throw notFound('Essa pessoa não está no quadro');
      members.set(
        boardId,
        list.filter((m) => m.userId !== userId),
      );
    },

    async listInvites() {
      await enter('listInvites', []);
      signedIn();
      return copy(invites);
    },

    async acceptInvite(boardId) {
      await enter('acceptInvite', [boardId]);
      signedIn();
      const invite = invites.find((i) => i.boardId === boardId);
      if (!invite) throw notFound('Convite não encontrado');
      invites = invites.filter((i) => i.boardId !== boardId);
      const board: BoardSummary = { id: boardId, name: invite.boardName, kind: 'group', role: 'editor' };
      boards = [...boards, board];
      return copy(board);
    },

    async declineInvite(boardId) {
      await enter('declineInvite', [boardId]);
      signedIn();
      if (!invites.some((i) => i.boardId === boardId)) throw notFound('Convite não encontrado');
      invites = invites.filter((i) => i.boardId !== boardId);
    },
  };
}
