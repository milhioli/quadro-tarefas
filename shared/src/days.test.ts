import { describe, expect, it } from 'vitest';
import { DAYS, DAY_COUNT, DAY_NAMES, DAY_SHORT_NAMES, dayName, isValidDay } from './days';

describe('days', () => {
  it('define as cinco colunas de segunda a sexta', () => {
    expect(DAY_COUNT).toBe(5);
    expect(DAYS).toEqual([0, 1, 2, 3, 4]);
    expect(DAY_NAMES).toEqual(['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta']);
    expect(DAY_SHORT_NAMES).toEqual(['Seg', 'Ter', 'Qua', 'Qui', 'Sex']);
  });

  it('isValidDay aceita apenas 0 a 4', () => {
    expect(isValidDay(0)).toBe(true);
    expect(isValidDay(4)).toBe(true);
    expect(isValidDay(5)).toBe(false);
    expect(isValidDay(-1)).toBe(false);
    expect(isValidDay(2.5)).toBe(false);
    expect(isValidDay('1')).toBe(false);
  });

  it('dayName devolve o nome ou lança erro', () => {
    expect(dayName(0)).toBe('Segunda');
    expect(dayName(4)).toBe('Sexta');
    expect(() => dayName(5)).toThrow(RangeError);
  });
});
