import { describe, expect, it } from 'vitest';
import { ACCOUNT_STATUS_LABELS, formatLastSeen } from './accounts';

describe('formatLastSeen', () => {
  it('data e hora curtas em pt-BR, no fuso pedido', () => {
    expect(formatLastSeen('2026-11-19T15:30:00.000Z', 'UTC')).toMatch(/^19\/11\/2026,? 15:30$/);
    expect(formatLastSeen('2026-11-19T15:30:00.000Z', 'America/Sao_Paulo')).toMatch(/^19\/11\/2026,? 12:30$/);
  });

  it('data estragada vira um traço', () => {
    expect(formatLastSeen('ontem')).toBe('—');
  });
});

describe('ACCOUNT_STATUS_LABELS', () => {
  it('rótulos em pt-BR', () => {
    expect(ACCOUNT_STATUS_LABELS).toEqual({ active: 'Ativa', disabled: 'Desativada' });
  });
});
