import { describe, expect, it } from 'vitest';
import { NEXT_MAX_LENGTH, sanitizeNext } from './redirect';

const ORIGIN = new URL('http://127.0.0.1:5173');

describe('sanitizeNext', () => {
  it.each([
    ['/', '/'],
    ['/?board=3', '/?board=3'],
    ['/?hoje=2026-11-16&board=2', '/?hoje=2026-11-16&board=2'],
    ['/quadro#topo', '/quadro#topo'],
    ['/a/../b', '/b'],
  ])('aceita o caminho do app %s', (raw, expected) => {
    expect(sanitizeNext(raw, ORIGIN)).toBe(expected);
  });

  it.each([
    ['protocolo relativo', '//evil.com'],
    ['barra invertida', '/\\evil.com'],
    ['barra invertida dupla', '\\\\evil.com'],
    ['barra codificada', '/%2F%2Fevil.com'],
    ['barra codificada minúscula', '/%2f%2fevil.com'],
    ['barra invertida codificada', '/%5Cevil.com'],
    ['URL absoluta', 'https://evil.com'],
    ['URL absoluta da própria origem', 'http://127.0.0.1:5173/'],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,oi'],
    ['tab no meio', '/\t/evil.com'],
    ['quebra de linha', '/\n/evil.com'],
    ['espaço', '/ /evil.com'],
    ['sem barra', 'evil.com'],
    ['vazio', ''],
    ['codificação quebrada', '/%E0%A4%A'],
    ['rota da API', '/api/auth/google/start'],
    ['raiz da API', '/api'],
    ['aspas', '/"onload'],
    ['arroba', '/@evil.com'],
  ])('%s vira /', (_label, raw) => {
    expect(sanitizeNext(raw, ORIGIN)).toBe('/');
  });

  it('o que não é string vira / (query repetida chega como lista)', () => {
    for (const raw of [undefined, null, 3, ['/a', '/b'], { next: '/' }]) {
      expect(sanitizeNext(raw, ORIGIN)).toBe('/');
    }
  });

  it('caminho longo demais vira /', () => {
    expect(sanitizeNext(`/${'a'.repeat(NEXT_MAX_LENGTH)}`, ORIGIN)).toBe('/');
    expect(sanitizeNext(`/${'a'.repeat(NEXT_MAX_LENGTH - 1)}`, ORIGIN)).toBe(`/${'a'.repeat(NEXT_MAX_LENGTH - 1)}`);
  });
});
