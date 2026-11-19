import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BoardProvider, useBoardId } from './BoardContext';

describe('BoardContext', () => {
  it('useBoardId devolve o quadro do provider', () => {
    const wrapper = ({ children }: { children: ReactNode }) => <BoardProvider boardId={7}>{children}</BoardProvider>;
    expect(renderHook(() => useBoardId(), { wrapper }).result.current).toBe(7);
  });

  it('fora do provider, falha com mensagem clara', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useBoardId())).toThrow('useBoardId precisa estar dentro de <BoardProvider>');
    spy.mockRestore();
  });
});
