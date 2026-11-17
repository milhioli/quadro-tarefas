import { describe, expect, it } from 'vitest';
import { fixedClock, systemClock } from './clock';

describe('systemClock', () => {
  it('devolve o instante atual', () => {
    const before = Date.now();
    const now = systemClock().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});

describe('fixedClock', () => {
  it('devolve sempre o mesmo instante, em objetos novos', () => {
    const clock = fixedClock('2026-11-13T12:00:00.000Z');
    const a = clock();
    const b = clock();
    expect(a.toISOString()).toBe('2026-11-13T12:00:00.000Z');
    expect(b.getTime()).toBe(a.getTime());
    expect(b).not.toBe(a);
    a.setUTCFullYear(2000);
    expect(clock().toISOString()).toBe('2026-11-13T12:00:00.000Z');
  });

  it('aceita um Date', () => {
    const clock = fixedClock(new Date(2026, 10, 13, 12));
    expect(clock().getDate()).toBe(13);
  });

  it('rejeita data inválida', () => {
    expect(() => fixedClock('não é data')).toThrow(RangeError);
    expect(() => fixedClock(new Date(Number.NaN))).toThrow(RangeError);
  });
});
