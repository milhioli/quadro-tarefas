import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createTempDb, type TempDb } from '../test/helpers/tempDb';
import { E2eStartError, assertE2eEnvironment, assertStaticPorts, e2eAdminEmail, exampleOnly, startE2eServer } from './e2eEntry';
import { DEFAULT_DB_PATH } from './index';

let temp: TempDb | undefined;
afterEach(() => {
  temp?.cleanup();
  temp = undefined;
});

const BASE = { DB_PATH: '/tmp/quadro-e2e/teste.sqlite' };

/** Uma porta livre em 127.0.0.1 (o --static exige uma porta real e explícita). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

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

describe('e2eAdminEmail e exampleOnly', () => {
  it('só contas de teste: o admin e o contato do E2E', () => {
    expect(e2eAdminEmail('admin@example.com')).toBe('admin@example.com');
    expect(e2eAdminEmail('pessoa@gmail.com')).toBeNull();
    expect(e2eAdminEmail(null)).toBeNull();
    expect(exampleOnly('contato@example.com')).toBe('contato@example.com');
    expect(exampleOnly('contato@exemplo.com.br')).toBeNull();
  });
});

describe('assertStaticPorts', () => {
  it('--static exige API_PORT e WEB_PORT explícitos e iguais', () => {
    expect(() => assertStaticPorts({ API_PORT: '3201', WEB_PORT: '3201' })).not.toThrow();
    for (const env of [{}, { API_PORT: '3201' }, { API_PORT: '3201', WEB_PORT: '5273' }, { API_PORT: '0', WEB_PORT: '0' }]) {
      expect(() => assertStaticPorts(env), JSON.stringify(env)).toThrow(E2eStartError);
    }
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

  it('recusa APP_ORIGIN fora do loopback, inclusive https', async () => {
    temp = createTempDb({ migrate: false });
    await expect(
      startE2eServer({ env: envFor(temp, { APP_ORIGIN: 'http://192.168.0.10:5273' }), logger: false }),
    ).rejects.toThrow();
    await expect(startE2eServer({ env: envFor(temp, { APP_ORIGIN: 'https://localhost' }), logger: false })).rejects.toThrow(
      /loopback/,
    );
  });

  it('o contato do E2E só aparece se for @example.com', async () => {
    temp = createTempDb({ migrate: false });
    const app = await startE2eServer({
      env: envFor(temp, { QUADRO_CONTACT_EMAIL: 'contato@example.com', QUADRO_OPERATOR_NAME: 'Operador E2E' }),
      logger: false,
    });
    try {
      const info = await app.inject({ method: 'GET', url: '/api/info', headers: { host: '127.0.0.1:5273' } });
      expect(info.json()).toEqual({ contactEmail: 'contato@example.com', operatorName: 'Operador E2E' });
    } finally {
      await app.close();
    }
    const other = await startE2eServer({
      env: envFor(temp, { DB_PATH: join(temp.dir, 'outro.sqlite'), QUADRO_CONTACT_EMAIL: 'contato@gmail.com' }),
      logger: false,
    });
    try {
      const info = await other.inject({ method: 'GET', url: '/api/info', headers: { host: '127.0.0.1:5273' } });
      expect(info.json()).toEqual({ contactEmail: null, operatorName: null });
    } finally {
      await other.close();
    }
  });

  it('--static: porta única, recusa sem o build e serve o web com a CSP do HTML', async () => {
    temp = createTempDb({ migrate: false });
    const env = { ...envFor(temp), API_PORT: '0', WEB_PORT: '0' };
    const argv = ['node', 'src/e2eEntry.ts', '--static'];
    await expect(startE2eServer({ env, argv, logger: false })).rejects.toThrow(/API_PORT e WEB_PORT iguais/);

    const port = String(await freePort());
    const single = { ...envFor(temp), API_PORT: port, WEB_PORT: port, APP_ORIGIN: `http://127.0.0.1:${port}` };
    const webDistDir = join(temp.dir, 'dist');
    await expect(startE2eServer({ env: single, argv, logger: false, webDistDir })).rejects.toThrow(/npm run build/);

    mkdirSync(webDistDir);
    writeFileSync(join(webDistDir, 'index.html'), '<!doctype html><title>Quadro</title>');
    const app = await startE2eServer({ env: single, argv, logger: false, webDistDir });
    try {
      const page = await app.inject({ method: 'GET', url: '/', headers: { host: `127.0.0.1:${port}` } });
      expect(page.statusCode).toBe(200);
      expect(page.headers['content-security-policy']).toContain("style-src 'self'");
    } finally {
      await app.close();
    }
    // Sem --static, nada de estáticos.
    const plain = await startE2eServer({ env: { ...envFor(temp), DB_PATH: join(temp.dir, 'sem-static.sqlite') }, logger: false });
    try {
      expect((await plain.inject({ method: 'GET', url: '/', headers: { host: '127.0.0.1:5273' } })).statusCode).toBe(401);
    } finally {
      await plain.close();
    }
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
