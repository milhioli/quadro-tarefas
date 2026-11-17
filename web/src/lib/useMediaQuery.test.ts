import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setViewport } from '../test/viewport';
import { MOBILE_QUERY, useMediaQuery } from './useMediaQuery';

describe('useMediaQuery', () => {
  it('MOBILE_QUERY é até 768 px', () => {
    expect(MOBILE_QUERY).toBe('(max-width: 768px)');
  });

  it('começa como desktop nos testes', () => {
    const { result } = renderHook(() => useMediaQuery(MOBILE_QUERY));
    expect(result.current).toBe(false);
  });

  it('lê o valor inicial e acompanha a mudança de tamanho', () => {
    setViewport('mobile');
    const { result } = renderHook(() => useMediaQuery(MOBILE_QUERY));
    expect(result.current).toBe(true);

    act(() => setViewport('desktop'));
    expect(result.current).toBe(false);

    act(() => setViewport('mobile'));
    expect(result.current).toBe(true);
  });

  it('sem matchMedia no ambiente, assume desktop', () => {
    const original = window.matchMedia;
    // @ts-expect-error simulando ambiente sem matchMedia
    delete window.matchMedia;
    try {
      const { result } = renderHook(() => useMediaQuery(MOBILE_QUERY));
      expect(result.current).toBe(false);
    } finally {
      window.matchMedia = original;
    }
  });
});
