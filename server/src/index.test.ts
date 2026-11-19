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
