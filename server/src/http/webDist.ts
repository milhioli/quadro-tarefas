import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { PRIVACY_PATH } from '@quadro/shared';
import type { FastifyInstance } from 'fastify';
import { HttpError } from './errors';

/**
 * Estáticos do build do Vite (`web/dist`), servidos pelo próprio Fastify no
 * deploy e no E2E de produção (Fase 2b, docs/fase-2b.md).
 *
 * Sem `@fastify/static`: a rota curinga dele não seria `public` e quebraria a
 * lista fechada de rotas sem sessão. Aqui tudo é lido para a memória uma vez,
 * na subida: a requisição nunca toca o disco (sem traversal, dotfile ou
 * symlink), e só existem três rotas.
 */
export interface WebDist {
  index: Buffer;
  assets: ReadonlyMap<string, { body: Buffer; type: string }>;
}

export class WebDistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebDistError';
  }
}

/** CSP do HTML: nada inline, nada de fora. `wss:` entra só na Fase 3. */
export const HTML_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; " +
  "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export const HTML_PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=()';

/** Os arquivos de `assets/` têm hash no nome: podem ficar em cache para sempre. */
export const ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';

const ASSET_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
});

/** Nome de arquivo de asset: sem barra, sem começar com ponto. */
const ASSET_NAME = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,199}$/;

export function loadWebDist(dir: string): WebDist {
  const indexPath = join(dir, 'index.html');
  if (!existsSync(indexPath)) {
    throw new WebDistError('web/dist/index.html não existe: rode npm run build');
  }
  const assets = new Map<string, { body: Buffer; type: string }>();
  const assetsDir = join(dir, 'assets');
  if (existsSync(assetsDir)) {
    for (const name of readdirSync(assetsDir)) {
      const type = ASSET_TYPES[extname(name).toLowerCase()];
      if (!ASSET_NAME.test(name) || type === undefined) continue;
      const path = join(assetsDir, name);
      if (!statSync(path).isFile()) continue;
      assets.set(name, { body: readFileSync(path), type });
    }
  }
  return { index: readFileSync(indexPath), assets };
}

/** `/`, `/privacidade` e `/assets/:file`, todas públicas (a página de login precisa abrir sem sessão). */
export function registerWebRoutes(app: FastifyInstance, dist: WebDist): void {
  for (const path of ['/', PRIVACY_PATH]) {
    app.get(path, { config: { public: true } }, async (_request, reply) => {
      reply
        .header('Content-Security-Policy', HTML_SECURITY_POLICY)
        .header('Permissions-Policy', HTML_PERMISSIONS_POLICY)
        .type('text/html; charset=utf-8');
      return dist.index;
    });
  }
  app.get<{ Params: { file: string } }>('/assets/:file', { config: { public: true } }, async (request, reply) => {
    const asset = dist.assets.get(request.params.file);
    if (asset === undefined) throw new HttpError(404, 'NOT_FOUND', 'Arquivo não encontrado');
    reply.header('Cache-Control', ASSET_CACHE_CONTROL).type(asset.type);
    return asset.body;
  });
}
