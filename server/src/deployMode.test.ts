import { describe, expect, it } from 'vitest';
import { loadAuthConfig, type AuthConfig } from './auth/config';
import { DeployModeError, resolveDeployMode } from './deployMode';

const SECRET = 'GOCSPX-segredo-de-teste';

/** Ambiente completo de produção (valores fictícios). */
function productionEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: 'production',
    APP_ORIGIN: 'https://quadro.exemplo.com',
    GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: SECRET,
    QUADRO_ADMIN_EMAIL: 'admin@exemplo.com',
    QUADRO_CONTACT_EMAIL: 'contato@exemplo.com',
    QUADRO_OPERATOR_NAME: 'Operador de Teste',
    DB_PATH: '/data/quadro.sqlite',
    ...overrides,
  };
}

function resolve(env: Record<string, string | undefined>, argv: readonly string[] = []) {
  const auth: AuthConfig = loadAuthConfig(env, { webPort: 5173 });
  return resolveDeployMode(env, argv, auth);
}

function errorOf(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error('esperava um erro');
}

describe('resolveDeployMode', () => {
  it('sem NODE_ENV e com APP_ORIGIN de loopback: local, como sempre', () => {
    expect(resolve({})).toBe('local');
    expect(resolve({ NODE_ENV: 'development', APP_ORIGIN: 'http://localhost:5173' })).toBe('local');
  });

  it('com os dois sinais e tudo configurado: public', () => {
    expect(resolve(productionEnv())).toBe('public');
  });

  it('https sem NODE_ENV=production é recusado (um dev nunca sobe em modo público por engano)', () => {
    const error = errorOf(() => resolve({ APP_ORIGIN: 'https://quadro.exemplo.com' }));
    expect(error).toBeInstanceOf(DeployModeError);
    expect(error.message).toMatch(/pacote de deploy/);
  });

  it('produção com APP_ORIGIN http é recusada', () => {
    expect(() => resolve(productionEnv({ APP_ORIGIN: 'http://127.0.0.1:5173' }))).toThrow(/precisa ser https/);
  });

  it('produção recusa TLS desligado no ambiente', () => {
    expect(() => resolve(productionEnv({ NODE_TLS_REJECT_UNAUTHORIZED: '0' }))).toThrow(/TLS/);
  });

  it.each([
    ['GOOGLE_CLIENT_ID', { GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined }, 'GOOGLE_CLIENT_ID'],
    ['QUADRO_ADMIN_EMAIL', { QUADRO_ADMIN_EMAIL: '' }, 'QUADRO_ADMIN_EMAIL'],
    ['QUADRO_CONTACT_EMAIL', { QUADRO_CONTACT_EMAIL: undefined }, 'QUADRO_CONTACT_EMAIL'],
    ['QUADRO_OPERATOR_NAME', { QUADRO_OPERATOR_NAME: '  ' }, 'QUADRO_OPERATOR_NAME'],
    ['DB_PATH', { DB_PATH: undefined }, 'DB_PATH'],
  ])('produção sem %s é recusada', (_name, overrides, expected) => {
    const error = errorOf(() => resolve(productionEnv(overrides)));
    expect(error).toBeInstanceOf(DeployModeError);
    expect(error.message).toContain(expected);
  });

  it('produção recusa a agenda global: a flag e qualquer ICLOUD_* no ambiente', () => {
    expect(() => resolve(productionEnv(), ['node', 'index.ts', '--agenda'])).toThrow(/--agenda/);
    expect(() => resolve(productionEnv({ ICLOUD_APPLE_ID: 'alguem@exemplo.com' }))).toThrow(/ICLOUD_/);
    expect(() => resolve(productionEnv({ ICLOUD_CALENDARS: 'Casa' }))).toThrow(/ICLOUD_/);
    expect(resolve(productionEnv({ ICLOUD_APP_PASSWORD: '' }))).toBe('public');
  });

  it('as mensagens nunca ecoam valores do ambiente', () => {
    const env = productionEnv({ ICLOUD_APPLE_ID: 'pessoa-real@exemplo.com', QUADRO_CONTACT_EMAIL: undefined });
    const error = errorOf(() => resolve(env));
    expect(error.message).not.toContain('pessoa-real');
    expect(error.message).not.toContain('quadro.exemplo.com');
    expect(error.message).not.toContain(SECRET);
  });
});
