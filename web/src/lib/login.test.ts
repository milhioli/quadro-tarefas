import { describe, expect, it } from 'vitest';
import { LOGIN_OUTCOMES } from '@quadro/shared';
import { LOGIN_NOTICES, googleStartUrl, parseLoginOutcome, withoutLoginParam } from './login';

describe('parseLoginOutcome', () => {
  it('aceita só os resultados conhecidos do servidor', () => {
    expect(parseLoginOutcome('?login=erro')).toBe('erro');
    expect(parseLoginOutcome('?hoje=2026-11-16&login=cancelado')).toBe('cancelado');
    expect(parseLoginOutcome('?login=indisponivel')).toBe('indisponivel');
    expect(parseLoginOutcome('?login=limite')).toBe('limite');
    expect(parseLoginOutcome('?login=desativada')).toBe('desativada');
    for (const search of ['', '?login=', '?login=<script>', '?login=ERRO', '?outro=erro', '?login=conta-apagada']) {
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

describe('LOGIN_NOTICES', () => {
  it('tem texto para cada resultado do servidor; só o "conta apagada" é informativo', () => {
    for (const outcome of LOGIN_OUTCOMES) expect(LOGIN_NOTICES[outcome].tone).toBe('error');
    expect(LOGIN_NOTICES['conta-apagada']).toEqual({ text: 'Sua conta foi apagada.', tone: 'info' });
  });
});
