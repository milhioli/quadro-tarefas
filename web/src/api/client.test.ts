// @vitest-environment node
import { emptyDoc, type Task } from '@quadro/shared';
import { describe, expect, it } from 'vitest';
import { ApiError, NETWORK_MESSAGE, UNKNOWN_MESSAGE, createApiClient, describeError, type FetchLike } from './client';

const task: Task = {
  id: 5,
  title: 'Estudar',
  color: 'azul',
  content: emptyDoc(),
  day: null,
  slot: null,
  span: 1,
  deckOrder: 0,
  createdAt: '2026-11-13T12:00:00.000Z',
  updatedAt: '2026-11-13T12:00:00.000Z',
};

interface Call {
  url: string;
  init: RequestInit;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function recorder(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  };
  return { calls, fetch };
}

const headersOf = (call: Call | undefined) => (call?.init.headers ?? {}) as Record<string, string>;

describe('createApiClient', () => {
  it('listTasks faz GET sem corpo, sem Content-Type e sem o header de mutação', async () => {
    const { calls, fetch } = recorder(() => json({ tasks: [task] }));
    const tasks = await createApiClient({ fetch }).listTasks();
    expect(tasks).toEqual([task]);
    expect(calls[0]?.url).toBe('/api/tasks');
    expect(calls[0]?.init.method).toBe('GET');
    expect(calls[0]?.init.body).toBeUndefined();
    expect(headersOf(calls[0])).toEqual({ Accept: 'application/json' });
    expect(calls[0]?.init.credentials).toBe('same-origin');
    expect(calls[0]?.init.cache).toBe('no-store');
  });

  it('createTask faz POST com JSON e X-Quadro-Client', async () => {
    const { calls, fetch } = recorder(() => json(task, 201));
    const created = await createApiClient({ fetch }).createTask({ title: 'Estudar', color: 'azul' });
    expect(created).toEqual(task);
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.body).toBe(JSON.stringify({ title: 'Estudar', color: 'azul' }));
    expect(headersOf(calls[0])).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Quadro-Client': '1',
    });
  });

  it('updateTask faz PATCH em /api/tasks/:id', async () => {
    const { calls, fetch } = recorder(() => json({ ...task, title: 'Novo' }));
    const updated = await createApiClient({ fetch }).updateTask(5, { title: 'Novo' });
    expect(updated.title).toBe('Novo');
    expect(calls[0]?.url).toBe('/api/tasks/5');
    expect(calls[0]?.init.method).toBe('PATCH');
  });

  it('deleteTask faz DELETE sem corpo nem Content-Type e aceita 204', async () => {
    const { calls, fetch } = recorder(() => new Response(null, { status: 204 }));
    await expect(createApiClient({ fetch }).deleteTask(5)).resolves.toBeUndefined();
    expect(calls[0]?.url).toBe('/api/tasks/5');
    expect(calls[0]?.init.method).toBe('DELETE');
    expect(calls[0]?.init.body).toBeUndefined();
    expect(headersOf(calls[0])).toEqual({ Accept: 'application/json', 'X-Quadro-Client': '1' });
  });

  it('moveTask faz PUT em /position com { to } e devolve a lista', async () => {
    const { calls, fetch } = recorder(() => json({ tasks: [task] }));
    const tasks = await createApiClient({ fetch }).moveTask(5, { kind: 'cell', day: 1, slot: 2 });
    expect(tasks).toEqual([task]);
    expect(calls[0]?.url).toBe('/api/tasks/5/position');
    expect(calls[0]?.init.method).toBe('PUT');
    expect(calls[0]?.init.body).toBe(JSON.stringify({ to: { kind: 'cell', day: 1, slot: 2 } }));
  });

  it('resetBoard faz POST sem corpo nem Content-Type', async () => {
    const { calls, fetch } = recorder(() => json({ tasks: [], moved: 0 }));
    await expect(createApiClient({ fetch }).resetBoard()).resolves.toEqual({ tasks: [], moved: 0 });
    expect(calls[0]?.url).toBe('/api/board/reset');
    expect(calls[0]?.init.body).toBeUndefined();
    expect(headersOf(calls[0])).toEqual({ Accept: 'application/json', 'X-Quadro-Client': '1' });
  });

  it('listCalendarEvents faz GET com X-Quadro-Client e a semana na query', async () => {
    const week = { enabled: true, events: [{ id: 'a', title: 'Dentista', start: 's', end: 'e', allDay: false }] };
    const { calls, fetch } = recorder(() => json(week));
    await expect(createApiClient({ fetch }).listCalendarEvents('2026-11-16')).resolves.toEqual(week);
    expect(calls[0]?.url).toBe('/api/calendar/events?week=2026-11-16');
    expect(calls[0]?.init.method).toBe('GET');
    expect(calls[0]?.init.body).toBeUndefined();
    expect(headersOf(calls[0])).toEqual({ Accept: 'application/json', 'X-Quadro-Client': '1' });
  });

  it('listCalendarEvents recusa semana que não é segunda sem chamar a rede', async () => {
    const { calls, fetch } = recorder(() => json({}));
    await expect(createApiClient({ fetch }).listCalendarEvents('2026-11-17')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(createApiClient({ fetch }).listCalendarEvents('x&y=1')).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(calls).toHaveLength(0);
  });

  it('listCalendarEvents normaliza resposta fora do formato', async () => {
    const { fetch } = recorder(() => json({ enabled: 'sim', events: 'nada' }));
    await expect(createApiClient({ fetch }).listCalendarEvents('2026-11-16')).resolves.toEqual({ enabled: false, events: [] });
  });

  it('usa o baseUrl', async () => {
    const { calls, fetch } = recorder(() => json({ tasks: [] }));
    await createApiClient({ fetch, baseUrl: 'http://127.0.0.1:3001' }).listTasks();
    expect(calls[0]?.url).toBe('http://127.0.0.1:3001/api/tasks');
  });

  it('rejeita id inválido sem chamar a rede', async () => {
    const { calls, fetch } = recorder(() => json({}));
    const api = createApiClient({ fetch });
    for (const id of [0, -1, 1.5, Number.NaN]) {
      await expect(api.deleteTask(id)).rejects.toMatchObject({ code: 'VALIDATION' });
    }
    expect(calls).toHaveLength(0);
  });
});

describe('erros', () => {
  it('converte o corpo de erro da API em ApiError', async () => {
    const { fetch } = recorder(() =>
      json(
        {
          error: {
            code: 'VALIDATION',
            message: 'Dados inválidos',
            issues: [{ path: 'title', message: 'Informe um título' }, { bogus: true }],
          },
        },
        400,
      ),
    );
    const error = await createApiClient({ fetch })
      .createTask({ title: '' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: 'VALIDATION',
      message: 'Dados inválidos',
      issues: [{ path: 'title', message: 'Informe um título' }],
    });
  });

  it('resposta de erro fora do formato vira UNKNOWN com mensagem genérica', async () => {
    const { fetch } = recorder(() => new Response('<html>502</html>', { status: 502 }));
    await expect(createApiClient({ fetch }).listTasks()).rejects.toMatchObject({
      status: 502,
      code: 'UNKNOWN',
      message: UNKNOWN_MESSAGE,
    });
  });

  it('falha de rede vira NETWORK', async () => {
    const fetch: FetchLike = async () => {
      throw new TypeError('fetch failed');
    };
    await expect(createApiClient({ fetch }).listTasks()).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK',
      message: NETWORK_MESSAGE,
    });
  });

  it('resposta 200 sem corpo é inválida', async () => {
    const { fetch } = recorder(() => new Response('', { status: 200 }));
    await expect(createApiClient({ fetch }).listTasks()).rejects.toMatchObject({ code: 'UNKNOWN' });
  });
});

describe('describeError', () => {
  it('usa o primeiro problema de validação', () => {
    const error = new ApiError(400, 'VALIDATION', 'Dados inválidos', [{ path: 'title', message: 'Título longo' }]);
    expect(describeError(error, 'Não foi possível salvar a tarefa')).toBe('Não foi possível salvar a tarefa. Título longo');
  });

  it('usa a mensagem da API sem problemas detalhados', () => {
    const error = new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Conteúdo grande demais para salvar');
    expect(describeError(error, 'Não foi possível salvar a tarefa')).toBe(
      'Não foi possível salvar a tarefa. Conteúdo grande demais para salvar',
    );
  });

  it('erro desconhecido mostra só o texto padrão', () => {
    expect(describeError(new Error('stack interna'), 'Não foi possível mover a tarefa')).toBe(
      'Não foi possível mover a tarefa',
    );
  });
});
