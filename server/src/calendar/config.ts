import { Buffer } from 'node:buffer';

/** Flag de linha de comando que liga a agenda (`npm run dev:agenda`). Nunca vem do .env. */
export const AGENDA_FLAG = '--agenda';

/** Formato da senha de app da Apple: xxxx-xxxx-xxxx-xxxx (hífens opcionais). */
export const APP_PASSWORD_PATTERN = /^[a-z]{4}-?[a-z]{4}-?[a-z]{4}-?[a-z]{4}$/;

export type CalendarOffReason = 'not-requested' | 'no-credentials' | 'tls-disabled';

export type CalendarConfig =
  | { readonly status: 'off'; readonly reason: CalendarOffReason }
  | {
      readonly status: 'on';
      readonly calendarNames: readonly string[];
      /** Monta o header Basic. A senha só existe nesta closure. */
      readonly authorization: () => string;
    };

export class CalendarConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalendarConfigError';
  }
}

/** Ambiente mutável: as chaves de credencial são apagadas depois de lidas. */
export type MutableEnv = Record<string, string | undefined>;

/**
 * Lê a configuração da agenda da Apple.
 * - A credencial sai do ambiente sempre (mesmo sem --agenda), para não ficar
 *   em process.env enquanto o processo viver.
 * - Só liga com a flag --agenda **e** as duas chaves.
 * - As mensagens de erro nunca ecoam os valores.
 */
export function loadCalendarConfig(env: MutableEnv, argv: readonly string[]): CalendarConfig {
  const appleId = env.ICLOUD_APPLE_ID?.trim() ?? '';
  const password = env.ICLOUD_APP_PASSWORD?.trim() ?? '';
  const calendarsRaw = env.ICLOUD_CALENDARS ?? '';
  delete env.ICLOUD_APPLE_ID;
  delete env.ICLOUD_APP_PASSWORD;

  if (!argv.includes(AGENDA_FLAG)) return Object.freeze({ status: 'off', reason: 'not-requested' });
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') return Object.freeze({ status: 'off', reason: 'tls-disabled' });
  if (!appleId && !password) return Object.freeze({ status: 'off', reason: 'no-credentials' });
  if (!appleId || !password) {
    throw new CalendarConfigError('Configure ICLOUD_APPLE_ID e ICLOUD_APP_PASSWORD juntos (ou nenhum dos dois).');
  }
  if (!APP_PASSWORD_PATTERN.test(password)) {
    throw new CalendarConfigError(
      'ICLOUD_APP_PASSWORD não tem o formato de uma senha de app (xxxx-xxxx-xxxx-xxxx). ' +
        'Gere uma em account.apple.com; não use a senha do Apple ID.',
    );
  }

  const calendarNames = Object.freeze(
    calendarsRaw
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
  );
  const header = `Basic ${Buffer.from(`${appleId}:${password}`, 'utf8').toString('base64')}`;
  return Object.freeze({ status: 'on', calendarNames, authorization: () => header });
}
