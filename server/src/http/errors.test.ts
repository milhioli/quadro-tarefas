import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  HttpError,
  LimitReachedError,
  StorageFullError,
  conflict,
  errorBody,
  forbidden,
  notFound,
  registerErrorHandling,
  toErrorResponse,
  tooManyRequests,
} from './errors';

describe('toErrorResponse', () => {
  it('usa status, código e mensagem do HttpError', () => {
    const res = toErrorResponse(new HttpError(400, 'VALIDATION', 'Dados inválidos', [{ path: 'title', message: 'x' }]));
    expect(res).toEqual({
      status: 400,
      body: { error: { code: 'VALIDATION', message: 'Dados inválidos', issues: [{ path: 'title', message: 'x' }] } },
      unexpected: false,
    });
  });

  it('mapeia 413, 415 e outros 4xx do Fastify', () => {
    expect(toErrorResponse({ statusCode: 413 }).body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(toErrorResponse({ statusCode: 415 }).body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(toErrorResponse({ statusCode: 400, message: 'Unexpected token } in JSON at position 3' })).toEqual({
      status: 400,
      body: { error: { code: 'VALIDATION', message: 'Requisição inválida' } },
      unexpected: false,
    });
  });

  it('erro inesperado vira 500 genérico, sem vazar mensagem nem stack', () => {
    const res = toErrorResponse(new Error('SQLITE_CORRUPT: /caminho/secreto/quadro.sqlite'));
    expect(res.status).toBe(500);
    expect(res.unexpected).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/SQLITE|secreto|at /);
    expect(res.body).toEqual({ error: { code: 'INTERNAL', message: 'Erro interno. Tente novamente.' } });
    expect(toErrorResponse(null).status).toBe(500);
  });

  it('helpers prontos para 403, 404 e 409', () => {
    expect(forbidden().statusCode).toBe(403);
    expect(notFound().message).toBe('Tarefa não encontrada');
    expect(toErrorResponse(conflict())).toEqual({
      status: 409,
      body: { error: { code: 'CONFLICT', message: 'Esse horário já está ocupado' } },
      unexpected: false,
    });
    expect(errorBody('NOT_FOUND', 'x', [])).toEqual({ error: { code: 'NOT_FOUND', message: 'x' } });
  });

  it('limite de taxa (429), teto (409) e banco cheio (503) chegam com o próprio status', () => {
    expect(toErrorResponse(tooManyRequests())).toEqual({
      status: 429,
      body: { error: { code: 'RATE_LIMITED', message: 'Muitas ações em pouco tempo. Espere alguns minutos e tente de novo.' } },
      unexpected: false,
    });
    expect(toErrorResponse(new LimitReachedError('Chegou ao limite'))).toEqual({
      status: 409,
      body: { error: { code: 'CONFLICT', message: 'Chegou ao limite' } },
      unexpected: false,
    });
    const full = toErrorResponse(new StorageFullError());
    expect(full.status).toBe(503);
    expect(full.body.error.code).toBe('STORAGE_FULL');
    expect(full.unexpected).toBe(false);
  });
});

describe('registerErrorHandling', () => {
  it('responde 500 genérico e registra o erro só no log', async () => {
    const app = Fastify({ logger: false });
    registerErrorHandling(app);
    const logError = vi.fn();
    app.addHook('onRequest', async (request) => {
      request.log.error = logError as unknown as typeof request.log.error;
    });
    app.get('/boom', async () => {
      throw new Error('detalhe interno com stack');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toMatch(/detalhe interno|stack/);
    expect(logError).toHaveBeenCalledOnce();
    await app.close();
  });

  it('rota desconhecida dá 404 em pt-BR', async () => {
    const app = Fastify({ logger: false });
    registerErrorHandling(app);
    const res = await app.inject({ method: 'GET', url: '/nada' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada' } });
    await app.close();
  });
});
