import { CLIENT_HEADER, CLIENT_HEADER_VALUE } from '@quadro/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { GuardOptions } from '../config';
import { forbidden } from './errors';

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);
const CLIENT_HEADER_KEY = CLIENT_HEADER.toLowerCase();

/**
 * Verifica o header Host por igualdade exata de hostname e porta.
 * Nada de startsWith/includes: `localhost.atacante.com` precisa falhar.
 */
export function isAllowedHost(host: string | undefined, options: GuardOptions): boolean {
  if (!host) return false;
  const match = /^([^:]+):(\d{1,5})$/.exec(host.trim().toLowerCase());
  if (!match) return false;
  const [, hostname, port] = match as unknown as [string, string, string];
  return options.allowedHostnames.includes(hostname) && options.allowedPorts.includes(Number(port));
}

/** Origin ausente é aceito (navegação/curl); presente, precisa ser exatamente uma das permitidas. */
export function isAllowedOrigin(origin: unknown, options: GuardOptions): boolean {
  if (origin === undefined) return true;
  return typeof origin === 'string' && options.allowedOrigins.includes(origin);
}

export function hasClientHeader(request: Pick<FastifyRequest, 'headers'>): boolean {
  return request.headers[CLIENT_HEADER_KEY] === CLIENT_HEADER_VALUE;
}

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

/**
 * Hook onRequest na raiz da aplicação (vale para todas as rotas, inclusive 404):
 * - Host fora da lista → 403 (anti DNS rebinding);
 * - Origin estranho ou "null" → 403;
 * - qualquer método fora de GET/HEAD (inclusive OPTIONS) sem X-Quadro-Client: 1 → 403.
 */
export function registerGuard(app: FastifyInstance, options: GuardOptions): void {
  app.addHook('onRequest', async (request) => {
    if (!isAllowedHost(request.headers.host, options)) throw forbidden();
    if (!isAllowedOrigin(request.headers.origin, options)) throw forbidden();
    if (!isSafeMethod(request.method) && !hasClientHeader(request)) throw forbidden();
  });
}
