import { describe, expect, it } from 'vitest';
import * as shared from './index';

describe('@quadro/shared', () => {
  it('reexporta os módulos públicos', () => {
    expect(shared.SLOT_COUNT).toBe(34);
    expect(shared.DAY_COUNT).toBe(5);
    expect(shared.TASK_COLORS).toContain('amarelo');
    expect(typeof shared.planMove).toBe('function');
    expect(typeof shared.validateRichDoc).toBe('function');
    expect(typeof shared.createTaskSchema.parse).toBe('function');
  });
});
