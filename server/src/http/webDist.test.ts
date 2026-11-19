import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, RouteOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTempDb, type TempDb } from '../../test/helpers/tempDb';
import { buildApp } from '../app';
import { ASSET_CACHE_CONTROL, HTML_PERMISSIONS_POLICY, HTML_SECURITY_POLICY, WebDistError, loadWebDist } from './webDist';

const HOST = { host: '127.0.0.1:3001' };
const INDEX = '<!doctype html><title>Quadro</title><script type="module" src="/assets/index-abc123.js"></script>';

let dir: string;
let temp: TempDb;
let app: FastifyInstance | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'quadro-dist-'));
  temp = createTempDb();
});
afterEach(async () => {
  await app?.close();
  app = undefined;
  temp.cleanup();
  rmSync(dir, { recursive: true, force: true });
});

/** Um build falso: o index, assets válidos e coisas que nunca podem ser servidas. */
function writeDist() {
  writeFileSync(join(dir, 'index.html'), INDEX);
  writeFileSync(join(dir, 'robots.txt'), 'fora de assets');
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log(1)');
  writeFileSync(join(dir, 'assets', 'index-abc123.css'), 'body{}');
  writeFileSync(join(dir, 'assets', '.env'), 'SEGREDO=1');
  writeFileSync(join(dir, 'assets', 'mapa.js.map'), '{}');
  writeFileSync(join(dir, 'assets', 'nota.txt'), 'texto');
  mkdirSync(join(dir, 'assets', 'sub.js'));
}

async function start(routes?: string[]) {
  writeDist();
  app = buildApp({
    db: temp.db,
    webDist: loadWebDist(dir),
    onRoute: routes
      ? (route: RouteOptions) => {
          const methods = Array.isArray(route.method) ? route.method : [route.method];
          for (const method of methods) if (method !== 'HEAD') routes.push(`${method} ${route.url}`);
        }
      : undefined,
  });
  await app.ready();
  return app;
}

describe('loadWebDist', () => {
  it('sem index.html, recusa subir com uma mensagem clara', () => {
    expect(() => loadWebDist(dir)).toThrow(WebDistError);
    expect(() => loadWebDist(dir)).toThrow(/npm run build/);
  });

  it('carrega só os arquivos diretos de assets/, com nome e extensão permitidos', () => {
    writeDist();
    const dist = loadWebDist(dir);
    expect(dist.index.toString()).toBe(INDEX);
    expect([...dist.assets.keys()].sort()).toEqual(['index-abc123.css', 'index-abc123.js']);
  });
});

describe('rotas do web', () => {
  it('/ e /privacidade servem o index com a CSP do HTML, sem cache', async () => {
    const server = await start();
    for (const url of ['/', '/privacidade']) {
      const res = await server.inject({ method: 'GET', url, headers: HOST });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(res.body).toBe(INDEX);
      expect(res.headers['content-security-policy']).toBe(HTML_SECURITY_POLICY);
      expect(res.headers['permissions-policy']).toBe(HTML_PERMISSIONS_POLICY);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
    }
  });

  it('a CSP do HTML não tem nada inline nem de fora', () => {
    expect(HTML_SECURITY_POLICY).not.toMatch(/unsafe-|\*|https?:|data: .*script/);
    expect(HTML_SECURITY_POLICY).toContain("script-src 'self'");
    expect(HTML_SECURITY_POLICY).toContain("style-src 'self'");
    expect(HTML_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(HTML_SECURITY_POLICY).toContain("object-src 'none'");
    expect(HTML_SECURITY_POLICY).toContain("base-uri 'none'");
  });

  it('assets com hash ficam em cache para sempre, com o tipo certo e a CSP da API', async () => {
    const server = await start();
    const js = await server.inject({ method: 'GET', url: '/assets/index-abc123.js', headers: HOST });
    expect(js.statusCode).toBe(200);
    expect(js.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(js.headers['cache-control']).toBe(ASSET_CACHE_CONTROL);
    expect(js.headers['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'");
    const css = await server.inject({ method: 'GET', url: '/assets/index-abc123.css', headers: HOST });
    expect(css.headers['content-type']).toBe('text/css; charset=utf-8');
  });

  it.each([
    '/assets/.env',
    '/assets/mapa.js.map',
    '/assets/nota.txt',
    '/assets/sub.js',
    '/assets/nada.js',
    '/assets/..%2Findex.html',
    '/assets/%2e%2e%2frobots.txt',
  ])('%s responde 404 sem cache', async (url) => {
    const server = await start();
    const res = await server.inject({ method: 'GET', url, headers: HOST });
    expect(res.statusCode, url).toBe(404);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('não há fallback de SPA: outros caminhos continuam com o 401 da API', async () => {
    const server = await start();
    for (const url of ['/index.html', '/robots.txt', '/qualquer', '/privacidade/x', '/assets/../index.html', '/api/nada']) {
      const res = await server.inject({ method: 'GET', url, headers: HOST });
      expect(res.statusCode, url).toBe(401);
    }
  });

  it('o guard vale para os estáticos: Host estranho dá 403', async () => {
    const server = await start();
    const res = await server.inject({ method: 'GET', url: '/', headers: { host: 'evil.com:3001' } });
    expect(res.statusCode).toBe(403);
  });

  it('só três rotas públicas novas, e só quando há um build', async () => {
    const routes: string[] = [];
    await start(routes);
    expect(routes.filter((r) => !r.includes('/api/')).sort()).toEqual(['GET /', 'GET /assets/:file', 'GET /privacidade']);

    const withoutDist: string[] = [];
    const plain = buildApp({
      db: temp.db,
      onRoute: (route: RouteOptions) => {
        if (!route.url.startsWith('/api/')) withoutDist.push(route.url);
      },
    });
    await plain.ready();
    await plain.close();
    expect(withoutDist).toEqual([]);
  });
});

describe('trustProxy', () => {
  /** O IP que o Fastify enxerga, por uma rota pública só deste teste. */
  async function ipSeen(behindProxy: boolean, remoteAddress: string): Promise<string> {
    const server = buildApp({ db: temp.db, behindProxy });
    server.get('/teste/ip', { config: { public: true } }, async (request) => ({ ip: request.ip }));
    await server.ready();
    try {
      const res = await server.inject({
        method: 'GET',
        url: '/teste/ip',
        headers: { ...HOST, 'x-forwarded-for': '203.0.113.9' },
        remoteAddress,
      });
      return (res.json() as { ip: string }).ip;
    } finally {
      await server.close();
    }
  }

  it('só com behindProxy o IP vem do X-Forwarded-For (gravado pelo Caddy)', async () => {
    expect(await ipSeen(false, '127.0.0.1')).toBe('127.0.0.1');
    expect(await ipSeen(true, '127.0.0.1')).toBe('203.0.113.9');
  });

  it('com behindProxy, um X-Forwarded-For vindo de fora do loopback é ignorado', async () => {
    expect(await ipSeen(true, '198.51.100.1')).toBe('198.51.100.1');
  });
});
