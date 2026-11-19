import { mkdirSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createTempDb, type TempDb } from '../test/helpers/tempDb';
import { DEFAULT_DB_PATH, isEntrypoint, main } from './index';

let temp: TempDb | undefined;
afterEach(() => {
  temp?.cleanup();
  temp = undefined;
});

describe('main', () => {
  it('sobe a API só em 127.0.0.1, migra o banco e fecha a conexão ao encerrar', async () => {
    temp = createTempDb({ migrate: false });
    const dbPath = join(temp.dir, 'main.sqlite');
    const app = await main({ env: { API_PORT: '0', DB_PATH: dbPath }, loadDotEnv: false, logger: false });
    try {
      const address = app.server.address() as AddressInfo;
      expect(address.address).toBe('127.0.0.1');
      expect(address.port).toBeGreaterThan(0);
      const res = await app.inject({ method: 'GET', url: '/api/health', headers: { host: '127.0.0.1:5173' } });
      expect(res.json()).toEqual({ ok: true });
    } finally {
      await app.close();
    }
  });

  it('sem --agenda a agenda fica desligada mesmo com as chaves, e a senha sai do ambiente', async () => {
    temp = createTempDb({ migrate: false });
    const env: Record<string, string | undefined> = {
      API_PORT: '0',
      DB_PATH: join(temp.dir, 'agenda-off.sqlite'),
      ICLOUD_APPLE_ID: 'pessoa@example.com',
      ICLOUD_APP_PASSWORD: 'abcd-efgh-ijkl-mnop',
    };
    const app = await main({ env, argv: ['node', 'src/index.ts'], loadDotEnv: false, logger: false });
    try {
      expect(env).not.toHaveProperty('ICLOUD_APP_PASSWORD');
      expect(env).not.toHaveProperty('ICLOUD_APPLE_ID');
      // Com API_PORT=0 só a porta do Vite (5173) está no allowlist do guard.
      // A agenda exige sessão; sem cookie, 401 (e nenhuma chamada à Apple).
      const res = await app.inject({
        method: 'GET',
        url: '/api/calendar/events?week=2026-11-16',
        headers: { host: '127.0.0.1:5173', 'x-quadro-client': '1' },
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('o servidor normal não tem login de desenvolvimento e apaga o segredo do Google do ambiente', async () => {
    temp = createTempDb({ migrate: false });
    const env: Record<string, string | undefined> = {
      API_PORT: '0',
      DB_PATH: join(temp.dir, 'normal.sqlite'),
      GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'GOCSPX-teste',
    };
    // Nenhum teste fala com o Google: o discovery passa por um fetch falso que só registra a URL e falha.
    const asked: string[] = [];
    const oidcFetch = async (url: string) => {
      asked.push(new URL(url).host);
      throw new TypeError('sem rede no teste');
    };
    const app = await main({ env, argv: ['node', 'src/index.ts'], loadDotEnv: false, logger: false, oidcFetch });
    try {
      expect(env).not.toHaveProperty('GOOGLE_CLIENT_SECRET');
      const headers = { host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173', 'x-quadro-client': '1' };
      const methods = await app.inject({ method: 'GET', url: '/api/auth/methods', headers });
      expect(methods.json()).toEqual({ google: false, dev: false });
      expect(asked).toEqual(['accounts.google.com']);
      const start = await app.inject({
        method: 'GET',
        url: '/api/auth/google/start',
        headers: { host: '127.0.0.1:5173', 'sec-fetch-site': 'same-origin' },
      });
      expect(start.statusCode).toBe(303);
      expect(start.headers.location).toBe('http://127.0.0.1:5173/?login=indisponivel');
      const dev = await app.inject({ method: 'POST', url: '/api/auth/dev/login', headers, payload: { email: 'a@example.com' } });
      expect(dev.statusCode).toBe(401);
      expect(dev.cookies).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('recusa APP_ORIGIN fora das origens do guard', async () => {
    temp = createTempDb({ migrate: false });
    const env = { API_PORT: '0', DB_PATH: join(temp.dir, 'x.sqlite'), APP_ORIGIN: 'http://127.0.0.1:5174' };
    await expect(main({ env, argv: ['node', 'src/index.ts'], loadDotEnv: false, logger: false })).rejects.toThrow(/APP_ORIGIN/);
  });

  it('com --agenda e senha fora do formato, não sobe e não ecoa a senha', async () => {
    temp = createTempDb({ migrate: false });
    const password = 'SenhaDoAppleID123';
    const env = {
      API_PORT: '0',
      DB_PATH: join(temp.dir, 'agenda-bad.sqlite'),
      ICLOUD_APPLE_ID: 'pessoa@example.com',
      ICLOUD_APP_PASSWORD: password,
    };
    const error = await main({ env, argv: ['node', 'src/index.ts', '--agenda'], loadDotEnv: false, logger: false }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('senha de app');
    expect((error as Error).message).not.toContain(password);
  });

  it('modo público (deploy): só o Host e o Origin do APP_ORIGIN, inclusive para o health check', async () => {
    temp = createTempDb({ migrate: false });
    const env: Record<string, string | undefined> = {
      NODE_ENV: 'production',
      API_PORT: '0',
      DB_PATH: join(temp.dir, 'publico.sqlite'),
      APP_ORIGIN: 'https://quadro.exemplo.com',
      GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'GOCSPX-teste',
      QUADRO_ADMIN_EMAIL: 'admin@exemplo.com',
      QUADRO_CONTACT_EMAIL: 'contato@exemplo.com',
      QUADRO_OPERATOR_NAME: 'Operador de Teste',
    };
    const oidcFetch = async () => {
      throw new TypeError('sem rede no teste');
    };
    const webDistDir = join(temp.dir, 'dist');
    // Sem o build do web, o modo público não sobe.
    await expect(
      main({ env: { ...env }, argv: ['node', 'src/index.ts'], loadDotEnv: false, logger: false, oidcFetch, webDistDir }),
    ).rejects.toThrow(/npm run build/);
    mkdirSync(webDistDir);
    writeFileSync(join(webDistDir, 'index.html'), '<!doctype html><title>Quadro</title>');
    const app = await main({ env, argv: ['node', 'src/index.ts'], loadDotEnv: false, logger: false, oidcFetch, webDistDir });
    try {
      expect((app.server.address() as AddressInfo).address).toBe('127.0.0.1');
      const page = await app.inject({ method: 'GET', url: '/privacidade', headers: { host: 'quadro.exemplo.com' } });
      expect(page.statusCode).toBe(200);
      expect(page.headers['content-security-policy']).toContain("script-src 'self'");
      const health = await app.inject({ method: 'GET', url: '/api/health', headers: { host: 'quadro.exemplo.com' } });
      expect(health.statusCode).toBe(200);
      // O loopback não é exceção: o HEALTHCHECK do contêiner manda o Host público.
      for (const host of ['127.0.0.1:3001', '127.0.0.1:5173', 'quadro.exemplo.com:443', 'quadro.exemplo.com.evil.com']) {
        const res = await app.inject({ method: 'GET', url: '/api/health', headers: { host } });
        expect(res.statusCode, host).toBe(403);
      }
      const info = await app.inject({ method: 'GET', url: '/api/info', headers: { host: 'quadro.exemplo.com' } });
      expect(info.json()).toEqual({ contactEmail: 'contato@exemplo.com', operatorName: 'Operador de Teste' });
      const wrongOrigin = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { host: 'quadro.exemplo.com', origin: 'http://127.0.0.1:5173', 'x-quadro-client': '1' },
      });
      expect(wrongOrigin.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('produção sem o que é obrigatório não sobe, e a agenda global é recusada', async () => {
    temp = createTempDb({ migrate: false });
    const base = {
      NODE_ENV: 'production',
      API_PORT: '0',
      DB_PATH: join(temp.dir, 'recusa.sqlite'),
      APP_ORIGIN: 'https://quadro.exemplo.com',
    };
    await expect(main({ env: { ...base }, argv: ['node', 'src/index.ts'], loadDotEnv: false, logger: false })).rejects.toThrow(
      /Em produção, informe/,
    );
    const complete = {
      ...base,
      GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'GOCSPX-teste',
      QUADRO_ADMIN_EMAIL: 'admin@exemplo.com',
      QUADRO_CONTACT_EMAIL: 'contato@exemplo.com',
      QUADRO_OPERATOR_NAME: 'Operador de Teste',
    };
    await expect(
      main({ env: { ...complete }, argv: ['node', 'src/index.ts', '--agenda'], loadDotEnv: false, logger: false }),
    ).rejects.toThrow(/--agenda/);
    // https sem NODE_ENV=production também não sobe.
    await expect(
      main({ env: { ...complete, NODE_ENV: undefined }, argv: ['node', 'src/index.ts'], loadDotEnv: false, logger: false }),
    ).rejects.toThrow(/pacote de deploy/);
  });

  it('o banco padrão fica em server/data', () => {
    expect(DEFAULT_DB_PATH.replaceAll('\\', '/')).toMatch(/server\/data\/quadro\.sqlite$/);
  });
});

describe('isEntrypoint', () => {
  const file = join(process.cwd(), 'src', 'index.ts');
  const url = pathToFileURL(file).href;

  it('reconhece o próprio arquivo como script executado', () => {
    expect(isEntrypoint(url, file)).toBe(true);
  });

  it('é falso quando outro script é executado ou não há argv', () => {
    expect(isEntrypoint(url, join(process.cwd(), 'outro.ts'))).toBe(false);
    expect(isEntrypoint(url, undefined)).toBe(false);
    expect(isEntrypoint('não é url', file)).toBe(false);
  });
});
