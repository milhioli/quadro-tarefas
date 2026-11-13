import { describe, expect, it } from 'vitest';
import { API_HOST, DEFAULT_GUARD_OPTIONS, guardOptionsFor, loadConfig } from './config';

const defaults = { dbPath: '/tmp/padrao.sqlite' };

describe('loadConfig', () => {
  it('usa os padrões quando o ambiente está vazio', () => {
    expect(loadConfig({}, defaults)).toEqual({ host: '127.0.0.1', port: 3001, webPort: 5173, dbPath: '/tmp/padrao.sqlite' });
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
    });
  });

  it('ignora a porta efêmera 0', () => {
    expect(guardOptionsFor({ port: 0, webPort: 5173 }).allowedPorts).toEqual([5173]);
  });

  it('o padrão corresponde às portas padrão', () => {
    expect(DEFAULT_GUARD_OPTIONS.allowedPorts).toEqual([3001, 5173]);
  });
});
