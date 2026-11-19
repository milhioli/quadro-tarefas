import { describe, expect, it } from 'vitest';
import { cleanSuggestion, createNameSuggestions } from './nameSuggestions';

describe('cleanSuggestion', () => {
  it('tira controles e caracteres de direção e corta em 40', () => {
    expect(cleanSuggestion('  Ana  ')).toBe('Ana');
    expect(cleanSuggestion('Ana‮axe\u0007')).toBe('Anaaxe');
    expect(Array.from(cleanSuggestion('é'.repeat(50)))).toHaveLength(40);
    expect(cleanSuggestion('​​')).toBe('');
  });
});

describe('createNameSuggestions', () => {
  it('guarda, devolve e apaga por usuário; vazio vira ""', () => {
    const s = createNameSuggestions();
    s.set(1, 'Ana');
    s.set(2, '‮');
    expect(s.get(1)).toBe('Ana');
    expect(s.get(2)).toBe('');
    s.delete(1);
    expect(s.get(1)).toBe('');
  });

  it('tem teto: o mais antigo sai', () => {
    const s = createNameSuggestions(2);
    s.set(1, 'A');
    s.set(2, 'B');
    s.set(3, 'C');
    expect([s.get(1), s.get(2), s.get(3)]).toEqual(['', 'B', 'C']);
  });
});
