import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { AuthConfigError, isLoopbackOrigin, loadAuthConfig } from './config';

const SECRET = 'GOCSPX-segredo-de-teste';

describe('loadAuthConfig', () => {
  it('sem nada configurado: origem padrão na porta do Vite, sem Google e sem admin', () => {
    const config = loadAuthConfig({}, { webPort: 5173 });
    expect(config.appOrigin.origin).toBe('http://127.0.0.1:5173');
    expect(config.google).toBeNull();
    expect(config.googleOffReason).toBe('not-configured');
    expect(config.adminEmail).toBeNull();
  });

  it('a origem padrão segue o WEB_PORT', () => {
    expect(loadAuthConfig({}, { webPort: 5273 }).appOrigin.origin).toBe('http://127.0.0.1:5273');
  });

  it('com o par do Google, o segredo sai do ambiente e só existe na closure', () => {
    const env: Record<string, string | undefined> = {
      GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: SECRET,
      QUADRO_ADMIN_EMAIL: '  Admin@Example.COM ',
    };
    const config = loadAuthConfig(env, { webPort: 5173 });
    expect(env).not.toHaveProperty('GOOGLE_CLIENT_SECRET');
    expect(config.google?.clientId).toBe('id.apps.googleusercontent.com');
    expect(config.google?.clientSecret()).toBe(SECRET);
    expect(config.adminEmail).toBe('admin@example.com');
    expect(JSON.stringify(config)).not.toContain(SECRET);
    expect(inspect(config, { depth: 10 })).not.toContain(SECRET);
  });

  it('o segredo sai do ambiente mesmo quando a configuração está incompleta', () => {
    const env: Record<string, string | undefined> = { GOOGLE_CLIENT_SECRET: SECRET };
    const error = (() => {
      try {
        loadAuthConfig(env, { webPort: 5173 });
        return undefined;
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(AuthConfigError);
    expect((error as Error).message).not.toContain(SECRET);
    expect(env).not.toHaveProperty('GOOGLE_CLIENT_SECRET');
  });

  it('id sem segredo também é recusado', () => {
    expect(() => loadAuthConfig({ GOOGLE_CLIENT_ID: 'x' }, { webPort: 5173 })).toThrow(/juntos/);
  });

  it('com TLS desligado no ambiente, o login Google não liga', () => {
    const config = loadAuthConfig(
      { GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: SECRET, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
      { webPort: 5173 },
    );
    expect(config.google).toBeNull();
    expect(config.googleOffReason).toBe('tls-disabled');
  });

  it.each([
    'https://quadro.exemplo.com',
    'http://192.168.0.10:5173',
    'http://127.0.0.1.exemplo.com:5173',
    'http://127.0.0.1:5173/app',
    'http://127.0.0.1:5173/?x=1',
    'http://user:pass@127.0.0.1:5173',
    'http://127.0.0.1:3000',
    'não é url',
  ])('recusa APP_ORIGIN %s', (origin) => {
    expect(() => loadAuthConfig({ APP_ORIGIN: origin }, { webPort: 5173 })).toThrow(AuthConfigError);
  });

  it('aceita localhost na porta do Vite', () => {
    expect(loadAuthConfig({ APP_ORIGIN: 'http://localhost:5173' }, { webPort: 5173 }).appOrigin.hostname).toBe('localhost');
  });

  it('recusa e-mail de admin malformado sem ecoar o valor', () => {
    expect(() => loadAuthConfig({ QUADRO_ADMIN_EMAIL: 'nao-e-email' }, { webPort: 5173 })).toThrow('QUADRO_ADMIN_EMAIL inválido');
  });
});

describe('isLoopbackOrigin', () => {
  it('só http em 127.0.0.1 ou localhost', () => {
    expect(isLoopbackOrigin(new URL('http://127.0.0.1:5273'))).toBe(true);
    expect(isLoopbackOrigin(new URL('http://localhost:5173'))).toBe(true);
    expect(isLoopbackOrigin(new URL('https://127.0.0.1:5173'))).toBe(false);
    expect(isLoopbackOrigin(new URL('http://10.0.0.2:5173'))).toBe(false);
  });
});
