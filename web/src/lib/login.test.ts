import { describe, expect, it } from 'vitest';
import { googleStartUrl, parseLoginOutcome, withoutLoginParam } from './login';

describe('parseLoginOutcome', () => {
  it('aceita só os três resultados conhecidos', () => {
    expect(parseLoginOutcome('?login=erro')).toBe('erro');
    expect(parseLoginOutcome('?hoje=2026-11-16&login=cancelado')).toBe('cancelado');
    expect(parseLoginOutcome('?login=indisponivel')).toBe('indisponivel');
    for (const search of ['', '?login=', '?login=<script>', '?login=ERRO', '?outro=erro']) {
      expect(parseLoginOutcome(search), search).toBeNull();
    }
  });
});

describe('withoutLoginParam', () => {
  it('tira só o login e mantém o resto da query', () => {
    expect(withoutLoginParam('/', '?login=erro')).toBe('/');
    expect(withoutLoginParam('/', '?hoje=2026-11-16&login=erro')).toBe('/?hoje=2026-11-16');
    expect(withoutLoginParam('/', '')).toBe('/');
  });
});

describe('googleStartUrl', () => {
  it('sem destino, o start puro; com destino, o next codificado', () => {
    expect(googleStartUrl('/')).toBe('/api/auth/google/start');
    expect(googleStartUrl('/?hoje=2026-11-16')).toBe('/api/auth/google/start?next=%2F%3Fhoje%3D2026-11-16');
  });
});
