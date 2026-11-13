import { describe, expect, it } from 'vitest';
import { SLOT_COUNT, SLOTS, isValidSlot, slotLabel } from './slots';

describe('slots', () => {
  it('gera 34 blocos de 30 minutos entre 05:00 e 22:00', () => {
    expect(SLOT_COUNT).toBe(34);
    expect(SLOTS).toHaveLength(34);
    expect(SLOTS[0]).toBe('05:00 – 05:30');
    expect(SLOTS.at(-1)).toBe('21:30 – 22:00');
  });

  it('formata cada rótulo com travessão e zero à esquerda', () => {
    expect(slotLabel(0)).toBe('05:00 – 05:30');
    expect(slotLabel(1)).toBe('05:30 – 06:00');
    expect(slotLabel(9)).toBe('09:30 – 10:00');
    expect(slotLabel(10)).toBe('10:00 – 10:30');
    expect(slotLabel(33)).toBe('21:30 – 22:00');
    expect(slotLabel(0)).toContain('–');
  });

  it('rejeita índices fora do intervalo ou não inteiros', () => {
    expect(() => slotLabel(-1)).toThrow(RangeError);
    expect(() => slotLabel(34)).toThrow(RangeError);
    expect(() => slotLabel(1.5)).toThrow(RangeError);
    expect(() => slotLabel(Number.NaN)).toThrow(RangeError);
  });

  it('isValidSlot aceita apenas inteiros de 0 a 33', () => {
    expect(isValidSlot(0)).toBe(true);
    expect(isValidSlot(33)).toBe(true);
    expect(isValidSlot(34)).toBe(false);
    expect(isValidSlot('1')).toBe(false);
    expect(isValidSlot(null)).toBe(false);
  });

  it('a lista de rótulos é imutável', () => {
    expect(Object.isFrozen(SLOTS)).toBe(true);
  });
});
