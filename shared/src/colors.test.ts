import { describe, expect, it } from 'vitest';
import { COLOR_LABELS, DEFAULT_COLOR, TASK_COLORS, isTaskColor } from './colors';

describe('colors', () => {
  it('tem sete cores com rótulo em pt-BR', () => {
    expect(TASK_COLORS).toHaveLength(7);
    for (const color of TASK_COLORS) {
      expect(COLOR_LABELS[color]).toMatch(/^[A-Z]/);
    }
    expect(TASK_COLORS).toContain(DEFAULT_COLOR);
  });

  it('isTaskColor aceita só cores da lista', () => {
    expect(isTaskColor('azul')).toBe(true);
    expect(isTaskColor('red')).toBe(false);
    expect(isTaskColor('url(javascript:alert(1))')).toBe(false);
    expect(isTaskColor(undefined)).toBe(false);
  });
});
