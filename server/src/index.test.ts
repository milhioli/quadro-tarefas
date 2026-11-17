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
      // Segunda-feira da semana atual (o main usa o relógio real).
      const today = new Date(Date.now());
      const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
      const week = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
      // Com API_PORT=0 só a porta do Vite (5173) está no allowlist do guard.
      const res = await app.inject({
        method: 'GET',
        url: `/api/calendar/events?week=${week}`,
        headers: { host: '127.0.0.1:5173', 'x-quadro-client': '1' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ enabled: false, events: [] });
    } finally {
      await app.close();
    }
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
