import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createTempDb, type TempDb } from '../test/helpers/tempDb';
import { E2eStartError, assertE2eEnvironment, e2eAdminEmail, startE2eServer } from './e2eEntry';
import { DEFAULT_DB_PATH } from './index';

let temp: TempDb | undefined;
afterEach(() => {
  temp?.cleanup();
  temp = undefined;
});

const BASE = { DB_PATH: '/tmp/quadro-e2e/teste.sqlite' };

function refusal(env: Record<string, string | undefined>): string {
  try {
    assertE2eEnvironment(env);
    return 'aceito';
  } catch (error) {
    return error instanceof E2eStartError ? error.message : `outro: ${String(error)}`;
  }
}

describe('assertE2eEnvironment', () => {
  it('aceita NODE_ENV ausente, development ou test, com um DB_PATH próprio', () => {
    for (const NODE_ENV of [undefined, 'development', 'test']) {
      expect(refusal({ ...BASE, NODE_ENV })).toBe('aceito');
    }
  });

  it.each(['production', 'Production', 'prod', 'staging'])('recusa NODE_ENV=%s', (NODE_ENV) => {
    expect(refusal({ ...BASE, NODE_ENV })).toMatch(/NODE_ENV/);
  });

  it('recusa DB_PATH ausente ou o banco real', () => {
    expect(refusal({})).toMatch(/DB_PATH/);
    expect(refusal({ DB_PATH: '  ' })).toMatch(/DB_PATH/);
    expect(refusal({ DB_PATH: DEFAULT_DB_PATH })).toMatch(/DB_PATH/);
  });

  it('recusa credenciais do Google ou da agenda no ambiente, sem ecoar valores', () => {
    for (const key of ['GOOGLE_CLIENT_SECRET', 'GOOGLE_CLIENT_ID', 'ICLOUD_APP_PASSWORD', 'ICLOUD_APPLE_ID']) {
      const message = refusal({ ...BASE, [key]: 'valor-secreto' });
      expect(message, key).not.toBe('aceito');
      expect(message).not.toContain('valor-secreto');
    }
    expect(refusal({ ...BASE, GOOGLE_CLIENT_ID: '' })).toBe('aceito');
  });
});

describe('e2eAdminEmail', () => {
  it('só uma conta de teste pode ser admin no E2E', () => {
    expect(e2eAdminEmail('admin@example.com')).toBe('admin@example.com');
    expect(e2eAdminEmail('pessoa@gmail.com')).toBeNull();
    expect(e2eAdminEmail(null)).toBeNull();
  });
});

describe('startE2eServer', () => {
  const envFor = (db: TempDb, extra: Record<string, string> = {}) => ({
    API_PORT: '0',
    WEB_PORT: '5273',
    APP_ORIGIN: 'http://127.0.0.1:5273',
    DB_PATH: join(db.dir, 'e2e.sqlite'),
    QUADRO_ADMIN_EMAIL: 'admin@example.com',
    ...extra,
  });

  it('sobe com o login de desenvolvimento e sem Google', async () => {
    temp = createTempDb({ migrate: false });
    const app = await startE2eServer({ env: envFor(temp), logger: false });
    try {
      const headers = { host: '127.0.0.1:5273', origin: 'http://127.0.0.1:5273', 'x-quadro-client': '1' };
      expect((await app.inject({ method: 'GET', url: '/api/auth/methods', headers })).json()).toEqual({ google: false, dev: true });
      const login = await app.inject({ method: 'POST', url: '/api/auth/dev/login', headers, payload: { email: 'ana@example.com' } });
      expect(login.statusCode).toBe(200);
      const outside = await app.inject({ method: 'POST', url: '/api/auth/dev/login', headers, payload: { email: 'ana@gmail.com' } });
      expect(outside.statusCode).toBe(400);
      const google = await app.inject({
        method: 'GET',
        url: '/api/auth/google/start',
        headers: { host: '127.0.0.1:5273', 'sec-fetch-site': 'same-origin' },
      });
      expect(google.statusCode).toBe(303);
      expect(google.headers.location).toBe('http://127.0.0.1:5273/?login=indisponivel');
      expect(google.cookies).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('não altera o ambiente de quem chamou', async () => {
    temp = createTempDb({ migrate: false });
    const env = envFor(temp);
    const app = await startE2eServer({ env, logger: false });
    await app.close();
    expect(env.QUADRO_ADMIN_EMAIL).toBe('admin@example.com');
  });

  it('recusa um banco que tenha conta real', async () => {
    temp = createTempDb();
    temp.db
      .prepare("INSERT INTO users (google_sub, email, created_at, last_seen_at) VALUES ('1234567890', 'real@gmail.com', 'x', 'x')")
      .run();
    temp.db.close();
    await expect(startE2eServer({ env: envFor(temp, { DB_PATH: temp.path }), logger: false })).rejects.toThrow(/contas reais/);
  });

  it('recusa APP_ORIGIN fora do loopback', async () => {
    temp = createTempDb({ migrate: false });
    await expect(
      startE2eServer({ env: envFor(temp, { APP_ORIGIN: 'http://192.168.0.10:5273' }), logger: false }),
    ).rejects.toThrow();
  });
});

describe('o login de desenvolvimento só existe no script de E2E', () => {
  const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

  it('só os scripts dev:e2e citam o e2eEntry', () => {
    for (const file of ['../package.json', '../../package.json']) {
      const scripts = (JSON.parse(read(file)) as { scripts: Record<string, string> }).scripts;
      for (const [name, command] of Object.entries(scripts)) {
        if (name === 'dev:e2e') continue;
        expect(command, `${file} ${name}`).not.toMatch(/e2eEntry/);
      }
    }
    const server = (JSON.parse(read('../package.json')) as { scripts: Record<string, string> }).scripts;
    expect(server['dev:e2e']).toBe('tsx src/e2eEntry.ts');
  });

  it('o index.ts não conhece o login de desenvolvimento', () => {
    const index = read('./index.ts');
    expect(index).not.toMatch(/e2eEntry/);
    expect(index).toMatch(/devLogin: false/);
  });
});
