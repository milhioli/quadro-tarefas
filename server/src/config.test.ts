import { describe, expect, it } from 'vitest';
import { API_HOST, DEFAULT_GUARD_OPTIONS, guardOptionsFor, loadConfig, publicGuardOptions } from './config';

const defaults = { dbPath: '/tmp/padrao.sqlite' };

describe('loadConfig', () => {
  it('usa os padrões quando o ambiente está vazio', () => {
    expect(loadConfig({}, defaults)).toEqual({
      host: '127.0.0.1',
      port: 3001,
      webPort: 5173,
      dbPath: '/tmp/padrao.sqlite',
      dbMaxMb: 1024,
    });
  });

  it('QUADRO_DB_MAX_MB: inteiro a partir de 16 MiB', () => {
    expect(loadConfig({ QUADRO_DB_MAX_MB: ' 2048 ' }, defaults).dbMaxMb).toBe(2048);
    for (const raw of ['abc', '15', '1.5', '-1', '99999999']) {
      expect(() => loadConfig({ QUADRO_DB_MAX_MB: raw }, defaults), raw).toThrow(/QUADRO_DB_MAX_MB/);
    }
  });

  it('o host é sempre 127.0.0.1, mesmo que alguém tente configurar', () => {
    const config = loadConfig({ HOST: '0.0.0.0', API_HOST: '0.0.0.0' }, defaults);
    expect(config.host).toBe(API_HOST);
    expect(API_HOST).toBe('127.0.0.1');
  });

  it('lê portas e caminho do banco do ambiente', () => {
    const config = loadConfig({ API_PORT: ' 4000 ', WEB_PORT: '5000', DB_PATH: ' /dados/q.sqlite ' }, defaults);
    expect(config).toMatchObject({ port: 4000, webPort: 5000, dbPath: '/dados/q.sqlite' });
  });

  it('aceita API_PORT=0 (porta efêmera, usada nos testes)', () => {
    expect(loadConfig({ API_PORT: '0' }, defaults).port).toBe(0);
  });

  it.each([
    [{ API_PORT: 'abc' }],
    [{ API_PORT: '80' }],
    [{ API_PORT: '70000' }],
    [{ API_PORT: '-1' }],
    [{ WEB_PORT: '0' }],
    [{ WEB_PORT: '3.5' }],
  ])('rejeita porta inválida %j', (env) => {
    expect(() => loadConfig(env, defaults)).toThrow(/inválida/);
  });
});

describe('guardOptionsFor', () => {
  it('libera só loopback nas portas da API e do Vite', () => {
    expect(guardOptionsFor({ port: 3001, webPort: 5173 })).toEqual({
      allowedHostnames: ['127.0.0.1', 'localhost'],
      allowedPorts: [3001, 5173],
      allowedOrigins: ['http://127.0.0.1:5173', 'http://localhost:5173'],
      publicHost: null,
    });
  });

  it('ignora a porta efêmera 0', () => {
    expect(guardOptionsFor({ port: 0, webPort: 5173 }).allowedPorts).toEqual([5173]);
  });

  it('o padrão corresponde às portas padrão', () => {
    expect(DEFAULT_GUARD_OPTIONS.allowedPorts).toEqual([3001, 5173]);
    expect(DEFAULT_GUARD_OPTIONS.publicHost).toBeNull();
  });
});

describe('publicGuardOptions', () => {
  it('deploy: só o host e a origem do APP_ORIGIN, sem loopback', () => {
    expect(publicGuardOptions(new URL('https://quadro.exemplo.com'))).toEqual({
      allowedHostnames: [],
      allowedPorts: [],
      allowedOrigins: ['https://quadro.exemplo.com'],
      publicHost: 'quadro.exemplo.com',
    });
    expect(publicGuardOptions(new URL('https://localhost')).publicHost).toBe('localhost');
  });
});
