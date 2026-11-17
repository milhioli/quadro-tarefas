import { describe, expect, it } from 'vitest';
import { SLOT_COUNT, SLOTS, isValidSlot, isValidSpan, rangeLabel, slotLabel, slotTime, spanDurationLabel } from './slots';

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

describe('duração (span)', () => {
  it('isValidSpan aceita inteiros de 1 a 34', () => {
    expect(isValidSpan(1)).toBe(true);
    expect(isValidSpan(34)).toBe(true);
    expect(isValidSpan(0)).toBe(false);
    expect(isValidSpan(35)).toBe(false);
    expect(isValidSpan(1.5)).toBe(false);
    expect(isValidSpan('2')).toBe(false);
  });

  it('slotTime dá a hora de cada fronteira, de 05:00 a 22:00', () => {
    expect(slotTime(0)).toBe('05:00');
    expect(slotTime(1)).toBe('05:30');
    expect(slotTime(30)).toBe('20:00');
    expect(slotTime(34)).toBe('22:00');
    expect(() => slotTime(-1)).toThrow(RangeError);
    expect(() => slotTime(35)).toThrow(RangeError);
    expect(() => slotTime(0.5)).toThrow(RangeError);
  });

  it('rangeLabel mostra a faixa inteira e, com span 1, é igual a slotLabel', () => {
    expect(rangeLabel(0, 30)).toBe('05:00 – 20:00');
    expect(rangeLabel(10, 2)).toBe('10:00 – 11:00');
    expect(rangeLabel(33, 1)).toBe('21:30 – 22:00');
    for (let slot = 0; slot < SLOT_COUNT; slot++) expect(rangeLabel(slot, 1)).toBe(slotLabel(slot));
  });

  it('rangeLabel recusa faixa que passa de 22:00 ou valores inválidos', () => {
    expect(() => rangeLabel(33, 2)).toThrow(RangeError);
    expect(() => rangeLabel(0, 35)).toThrow(RangeError);
    expect(() => rangeLabel(0, 0)).toThrow(RangeError);
    expect(() => rangeLabel(34, 1)).toThrow(RangeError);
  });

  it('spanDurationLabel escreve a duração em pt-BR', () => {
    expect(spanDurationLabel(1)).toBe('30 min');
    expect(spanDurationLabel(2)).toBe('1 h');
    expect(spanDurationLabel(3)).toBe('1 h 30');
    expect(spanDurationLabel(30)).toBe('15 h');
    expect(() => spanDurationLabel(0)).toThrow(RangeError);
  });
});
