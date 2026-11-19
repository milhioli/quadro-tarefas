import type { UserStatus } from '@quadro/shared';

/** "19/11/2026, 12:00" (ou "—" se a data vier estragada). O fuso padrão é o do navegador. */
export function formatLastSeen(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone }).format(date);
}

export const ACCOUNT_STATUS_LABELS: Readonly<Record<UserStatus, string>> = Object.freeze({
  active: 'Ativa',
  disabled: 'Desativada',
});
