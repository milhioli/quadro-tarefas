import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isoDate } from './calendar';
import { useToday } from './useToday';

let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});

afterEach(() => {
  vi.useRealTimers();
  delete (document as { visibilityState?: unknown }).visibilityState;
});

function mutableClock(initial: Date) {
  let current = initial;
  return {
    clock: () => new Date(current.getTime()),
    set(next: Date) {
      current = next;
    },
  };
}

describe('useToday', () => {
  it('devolve a data civil do relógio', () => {
    const { clock } = mutableClock(new Date(2026, 10, 13, 9));
    const { result } = renderHook(() => useToday(clock));
    expect(isoDate(result.current)).toBe('2026-11-13');
  });

  it('mantém a mesma referência enquanto o dia não muda e vira o dia no intervalo', () => {
    const time = mutableClock(new Date(2026, 10, 13, 23, 58));
    const { result } = renderHook(() => useToday(time.clock, 1000));
    const first = result.current;

    time.set(new Date(2026, 10, 13, 23, 59));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(first);

    time.set(new Date(2026, 10, 14, 0, 1));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(isoDate(result.current)).toBe('2026-11-14');
  });

  it('relê o relógio quando a aba volta a ficar visível', () => {
    const time = mutableClock(new Date(2026, 10, 13, 12));
    const { result } = renderHook(() => useToday(time.clock, 60_000));

    time.set(new Date(2026, 10, 16, 8));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(isoDate(result.current)).toBe('2026-11-16');
  });

  it('ignora visibilitychange com a aba escondida', () => {
    const time = mutableClock(new Date(2026, 10, 13, 12));
    const { result } = renderHook(() => useToday(time.clock, 60_000));

    visibility = 'hidden';
    time.set(new Date(2026, 10, 16, 8));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(isoDate(result.current)).toBe('2026-11-13');
  });

  it('para de ler o relógio ao desmontar', () => {
    const clock = vi.fn(() => new Date(2026, 10, 13, 12));
    const { unmount } = renderHook(() => useToday(clock, 1000));
    unmount();
    const calls = clock.mock.calls.length;
    vi.advanceTimersByTime(5000);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(clock.mock.calls.length).toBe(calls);
  });
});
