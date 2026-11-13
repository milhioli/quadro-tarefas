import { describe, expect, it } from 'vitest';
import { fixedNow, nowIso, systemNow } from './clock';

describe('clock', () => {
  it('fixedNow devolve sempre o mesmo instante, em cópias novas', () => {
    const now = fixedNow('2026-11-13T12:00:00.000Z');
    const a = now();
    const b = now();
    expect(a.toISOString()).toBe('2026-11-13T12:00:00.000Z');
    expect(a).not.toBe(b);
    expect(nowIso(now)).toBe('2026-11-13T12:00:00.000Z');
  });

  it('fixedNow rejeita data inválida', () => {
    expect(() => fixedNow('ontem')).toThrow(RangeError);
  });

  it('systemNow devolve um Date válido', () => {
    expect(Number.isNaN(systemNow().getTime())).toBe(false);
  });
});
