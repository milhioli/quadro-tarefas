import {
  DEFAULT_COLOR,
  MoveError,
  applyPositions,
  emptyDoc,
  nextDeckOrder,
  planMove,
  planPlacement,
  planReset,
  type CalendarWeekResponse,
  type Task,
} from '@quadro/shared';
import { ApiError, type ApiClient } from '../api/client';

/**
 * API em memória para testes de componente, com as mesmas regras de posição
 * do servidor (planMove/planReset do @quadro/shared). Não substitui os testes
 * de integração da API, que rodam contra SQLite real.
 */

export const T0 = '2026-11-13T12:00:00.000Z';

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
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

export type ApiMethod = keyof ApiClient;

export interface FakeApi extends ApiClient {
  /** Estado atual (cópia), na mesma ordem do servidor. */
  readonly tasks: Task[];
  readonly calls: Array<{ method: ApiMethod; args: unknown[] }>;
  /** A próxima chamada do método falha com `error`. */
  failNext(method: ApiMethod, error?: ApiError): void;
  /** A próxima chamada do método fica pendente até `release()`. */
  holdNext(method: ApiMethod): { release: () => void };
  /** O que a "agenda da Apple" devolve (padrão: desligada). */
  setCalendar(response: CalendarWeekResponse): void;
}

function serverOrder(tasks: readonly Task[]): Task[] {
  const onDeck = (t: Task) => t.day === null || t.slot === null;
  return [...tasks].sort((a, b) => {
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

  const copy = <T>(value: T): T => structuredClone(value);
  const notFound = () => new ApiError(404, 'NOT_FOUND', 'Tarefa não encontrada');

  /** Mesmo mapeamento do servidor (routes/tasks.ts → moveErrorToHttp). */
  function toApiError(error: unknown): unknown {
    if (!(error instanceof MoveError)) return error;
    if (error.code === 'NOT_FOUND') return notFound();
    if (error.code === 'OCCUPIED') return new ApiError(409, 'CONFLICT', 'Esse horário já está ocupado');
    return new ApiError(400, 'VALIDATION', error.message);
  }

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

    async listTasks() {
      await enter('listTasks', []);
      return copy(serverOrder(tasks));
    },

    async createTask(input) {
      await enter('createTask', [input]);
      const task: Task = {
        id: nextId++,
        title: input.title.trim(),
        color: input.color ?? DEFAULT_COLOR,
        content: input.content ?? emptyDoc(),
        day: null,
        slot: null,
        span: input.span ?? 1,
        deckOrder: nextDeckOrder(tasks),
        createdAt: T0,
        updatedAt: T0,
      };
      // Calcula tudo antes de gravar: em conflito, nada muda (como a transação do servidor).
      tasks = place([...tasks, task], task.id, input.position);
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
      tasks = place(
        tasks.map((t) => (t.id === id ? updated : t)),
        id,
        patch.position ?? keepCell,
      );
      return copy(find(id));
    },

    async deleteTask(id) {
      await enter('deleteTask', [id]);
      find(id);
      tasks = tasks.filter((t) => t.id !== id);
    },

    async moveTask(id, to) {
      await enter('moveTask', [id, to]);
      try {
        tasks = applyPositions(tasks, planMove(tasks, id, to));
      } catch (error) {
        throw toApiError(error);
      }
      return copy(serverOrder(tasks));
    },

    async resetBoard() {
      await enter('resetBoard', []);
      const changes = planReset(tasks);
      tasks = applyPositions(tasks, changes);
      return { tasks: copy(serverOrder(tasks)), moved: changes.length };
    },

    setCalendar(response) {
      calendar = copy(response);
    },

    async listCalendarEvents(mondayIso) {
      await enter('listCalendarEvents', [mondayIso]);
      return copy(calendar);
    },
  };
}
