import type { ApiErrorBody, ApiErrorCode } from '@quadro/shared';
import type { FastifyError, FastifyInstance } from 'fastify';

export type Issue = { path: string; message: string };

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;
  readonly issues: Issue[] | undefined;

  constructor(statusCode: number, code: ApiErrorCode, message: string, issues?: Issue[]) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.issues = issues;
  }
}

export const notFound = (message = 'Tarefa não encontrada'): HttpError => new HttpError(404, 'NOT_FOUND', message);
export const forbidden = (): HttpError => new HttpError(403, 'FORBIDDEN', 'Acesso negado');
export const conflict = (message = 'Esse horário já está ocupado'): HttpError =>
  new HttpError(409, 'CONFLICT', message);

export function errorBody(code: ApiErrorCode, message: string, issues?: Issue[]): ApiErrorBody {
  return issues && issues.length > 0 ? { error: { code, message, issues } } : { error: { code, message } };
}

/** Converte qualquer erro numa resposta genérica em pt-BR, sem stack trace. */
export function toErrorResponse(error: unknown): { status: number; body: ApiErrorBody; unexpected: boolean } {
  if (error instanceof HttpError) {
    return { status: error.statusCode, body: errorBody(error.code, error.message, error.issues), unexpected: false };
  }
  const status = (error as Partial<FastifyError> | null)?.statusCode;
  if (status === 413) {
    return { status, body: errorBody('PAYLOAD_TOO_LARGE', 'Conteúdo grande demais para salvar'), unexpected: false };
  }
  if (status === 415) {
    return { status, body: errorBody('UNSUPPORTED_MEDIA_TYPE', 'Formato de envio não suportado'), unexpected: false };
  }
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return { status: 400, body: errorBody('VALIDATION', 'Requisição inválida'), unexpected: false };
  }
  return { status: 500, body: errorBody('INTERNAL', 'Erro interno. Tente novamente.'), unexpected: true };
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const { status, body, unexpected } = toErrorResponse(error);
    if (unexpected) {
      // Só no log do servidor; nunca no corpo da resposta.
      request.log.error({ err: error }, 'Erro não tratado');
    }
    return reply.status(status).send(body);
  });

  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send(errorBody('NOT_FOUND', 'Rota não encontrada'));
  });
}
