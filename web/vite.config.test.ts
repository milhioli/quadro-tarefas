// @vitest-environment node
import { request } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VITE_ENV_KEYS, WEB_HOST, buildViteConfig, parsePort, securityHeaders } from './vite.config';

describe('VITE_ENV_KEYS', () => {
  it('o Vite só lê as portas do .env (nunca a senha da agenda)', () => {
    expect([...VITE_ENV_KEYS]).toEqual(['WEB_PORT', 'API_PORT']);
  });
});

describe('parsePort', () => {
  it('usa o padrão quando vazio', () => {
    expect(parsePort(undefined, 5173, 'WEB_PORT')).toBe(5173);
    expect(parsePort('  ', 5173, 'WEB_PORT')).toBe(5173);
  });

  it('aceita portas válidas', () => {
    expect(parsePort('5200', 5173, 'WEB_PORT')).toBe(5200);
    expect(parsePort(' 3100 ', 3001, 'API_PORT')).toBe(3100);
  });

  it('rejeita valores inválidos', () => {
    expect(() => parsePort('abc', 5173, 'WEB_PORT')).toThrow('WEB_PORT inválida');
    expect(() => parsePort('80', 5173, 'WEB_PORT')).toThrow('entre 1024 e 65535');
    expect(() => parsePort('70000', 5173, 'WEB_PORT')).toThrow('entre 1024 e 65535');
    expect(() => parsePort('5173.5', 5173, 'WEB_PORT')).toThrow('WEB_PORT inválida');
  });
});

describe('buildViteConfig', () => {
  it('escuta só em 127.0.0.1, sem CORS e com porta fixa', () => {
    const config = buildViteConfig({});
    expect(WEB_HOST).toBe('127.0.0.1');
    expect(config.server?.host).toBe('127.0.0.1');
    expect(config.server?.port).toBe(5173);
    expect(config.server?.strictPort).toBe(true);
    expect(config.server?.cors).toBe(false);
    expect(config.server?.allowedHosts).toBeUndefined();
    expect(config.build?.sourcemap).toBe(false);
  });

  it('faz proxy de /api para a API preservando o Host', () => {
    const proxy = buildViteConfig({}).server?.proxy?.['/api'];
    expect(proxy).toEqual({ target: 'http://127.0.0.1:3001', changeOrigin: false });
  });

  it('respeita WEB_PORT e API_PORT', () => {
    const config = buildViteConfig({ WEB_PORT: '5200', API_PORT: '3100' });
    expect(config.server?.port).toBe(5200);
    expect(config.server?.proxy?.['/api']).toEqual({ target: 'http://127.0.0.1:3100', changeOrigin: false });
    expect(config.server?.headers?.['Content-Security-Policy']).toContain('ws://127.0.0.1:5200');
  });

  it('falha cedo com porta inválida', () => {
    expect(() => buildViteConfig({ API_PORT: 'x' })).toThrow('API_PORT inválida');
  });
});

describe('securityHeaders', () => {
  it('bloqueia iframe, sniffing e referrer', () => {
    const headers = securityHeaders(5173);
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Referrer-Policy']).toBe('no-referrer');
    const csp = headers['Content-Security-Policy'];
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("connect-src 'self' ws://127.0.0.1:5173 ws://localhost:5173");
  });
});

// --- Servidor de desenvolvimento real ---------------------------------------

async function freePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
}

function rawRequest(port: number, method: string, path: string, headers: Record<string, string>): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('servidor de desenvolvimento do Vite', () => {
  let server: ViteDevServer;
  let port: number;
  let host: string;

  beforeAll(async () => {
    port = await freePort();
    host = `127.0.0.1:${port}`;
    const config = buildViteConfig({ WEB_PORT: String(port) });
    server = await createServer({
      ...config,
      configFile: false,
      root: fileURLToPath(new URL('.', import.meta.url)),
      logLevel: 'silent',
      server: { ...config.server, hmr: false },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    await server.listen();
  }, 30_000);

  afterAll(async () => {
    await server?.close();
  });

  it('serve a página com os headers de segurança', async () => {
    const res = await rawRequest(port, 'GET', '/', { host });
    expect(res.status).toBe(200);
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(String(res.headers['content-security-policy'])).toContain("frame-ancestors 'none'");
  });

  it('não responde preflight de outra origem com Access-Control-Allow-Origin', async () => {
    const res = await rawRequest(port, 'OPTIONS', '/', {
      host,
      origin: 'http://localhost:8080',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'x-quadro-client,content-type',
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('não libera CORS em GET de outra origem', async () => {
    const res = await rawRequest(port, 'GET', '/', { host, origin: 'http://localhost:8080' });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('recusa Host desconhecido (anti DNS rebinding)', async () => {
    const res = await rawRequest(port, 'GET', '/', { host: 'evil.com' });
    expect(res.status).toBe(403);
  });
});
