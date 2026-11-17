import { describe, expect, it } from 'vitest';
import { spanFromPointer } from './resize';

describe('spanFromPointer', () => {
  it('anda de slot em slot, arredondando para o mais próximo', () => {
    expect(spanFromPointer(100, 100, 40, 1, 10)).toBe(1);
    expect(spanFromPointer(100, 119, 40, 1, 10)).toBe(1);
    expect(spanFromPointer(100, 121, 40, 1, 10)).toBe(2);
    expect(spanFromPointer(100, 220, 40, 1, 10)).toBe(4);
    expect(spanFromPointer(100, 20, 40, 4, 10)).toBe(2);
  });

  it('nunca passa de maxSpan nem fica abaixo de 1', () => {
    expect(spanFromPointer(100, 5000, 40, 1, 3)).toBe(3);
    expect(spanFromPointer(100, -5000, 40, 5, 10)).toBe(1);
    expect(spanFromPointer(100, 500, 40, 1, 0)).toBe(1);
  });

  it('medida inválida mantém o span de partida', () => {
    expect(spanFromPointer(100, 300, 0, 2, 10)).toBe(2);
    expect(spanFromPointer(100, Number.NaN, 40, 2, 10)).toBe(2);
  });
});
