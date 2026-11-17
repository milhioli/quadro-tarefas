import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeApi } from '../test/fakeApi';
import { ApiProvider, useApi } from './ApiContext';

describe('ApiContext', () => {
  it('useApi devolve o cliente injetado', () => {
    const api = createFakeApi();
    const wrapper = ({ children }: { children: ReactNode }) => <ApiProvider client={api}>{children}</ApiProvider>;
    const { result } = renderHook(() => useApi(), { wrapper });
    expect(result.current).toBe(api);
  });

  it('useApi fora do provider lança erro claro', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useApi())).toThrow('useApi precisa estar dentro de <ApiProvider>');
    spy.mockRestore();
  });
});
