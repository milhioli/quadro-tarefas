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
