import { Buffer } from 'node:buffer';
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { AGENDA_FLAG, CalendarConfigError, loadCalendarConfig, type MutableEnv } from './config';

const APPLE_ID = 'pessoa@example.com';
const PASSWORD = 'abcd-efgh-ijkl-mnop';
const ARGV_ON = ['node', 'src/index.ts', AGENDA_FLAG];
const ARGV_OFF = ['node', 'src/index.ts'];

const envWith = (extra: MutableEnv = {}): MutableEnv => ({
  ICLOUD_APPLE_ID: APPLE_ID,
  ICLOUD_APP_PASSWORD: PASSWORD,
  ...extra,
});

function errorOf(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error('esperava um erro');
}

describe('loadCalendarConfig', () => {
  it('sem --agenda fica desligada mesmo com as chaves', () => {
    expect(loadCalendarConfig(envWith(), ARGV_OFF)).toEqual({ status: 'off', reason: 'not-requested' });
  });

  it('sempre tira a credencial do ambiente, ligada ou não', () => {
    const off = envWith();
    loadCalendarConfig(off, ARGV_OFF);
    expect(off).not.toHaveProperty('ICLOUD_APP_PASSWORD');
    expect(off).not.toHaveProperty('ICLOUD_APPLE_ID');

    const on = envWith();
    loadCalendarConfig(on, ARGV_ON);
    expect(on).not.toHaveProperty('ICLOUD_APP_PASSWORD');
    expect(on).not.toHaveProperty('ICLOUD_APPLE_ID');
  });

  it('com --agenda e sem chaves fica desligada', () => {
    expect(loadCalendarConfig({}, ARGV_ON)).toEqual({ status: 'off', reason: 'no-credentials' });
  });

  it('com TLS desligado no ambiente, recusa ligar', () => {
    expect(loadCalendarConfig(envWith({ NODE_TLS_REJECT_UNAUTHORIZED: '0' }), ARGV_ON)).toEqual({
      status: 'off',
      reason: 'tls-disabled',
    });
  });

  it('exige as duas chaves juntas, sem ecoar valores', () => {
    for (const env of [{ ICLOUD_APPLE_ID: APPLE_ID }, { ICLOUD_APP_PASSWORD: PASSWORD }]) {
      const error = errorOf(() => loadCalendarConfig(env, ARGV_ON));
      expect(error).toBeInstanceOf(CalendarConfigError);
      expect(error.message).not.toContain(APPLE_ID);
      expect(error.message).not.toContain(PASSWORD);
    }
  });

  it.each(['MinhaSenhaDoAppleID1', 'abcd-efgh-ijkl', 'ABCD-EFGH-IJKL-MNOP', 'abcd-efgh-ijkl-mnop-qrst', 'abc1-efgh-ijkl-mnop'])(
    'recusa senha fora do formato de senha de app (%s) sem ecoar',
    (password) => {
      const error = errorOf(() => loadCalendarConfig(envWith({ ICLOUD_APP_PASSWORD: password }), ARGV_ON));
      expect(error).toBeInstanceOf(CalendarConfigError);
      expect(error.message).toContain('senha de app');
      expect(error.message).not.toContain(password);
    },
  );

  it('aceita a senha de app com ou sem hífens e monta o Basic', () => {
    for (const password of [PASSWORD, 'abcdefghijklmnop', `  ${PASSWORD}  `]) {
      const config = loadCalendarConfig(envWith({ ICLOUD_APP_PASSWORD: password }), ARGV_ON);
      expect(config.status).toBe('on');
      if (config.status !== 'on') return;
      const expected = Buffer.from(`${APPLE_ID}:${password.trim()}`).toString('base64');
      expect(config.authorization()).toBe(`Basic ${expected}`);
    }
  });

  it('a config não expõe a senha nem o Basic ao ser serializada ou inspecionada', () => {
    const config = loadCalendarConfig(envWith(), ARGV_ON);
    const basic = Buffer.from(`${APPLE_ID}:${PASSWORD}`).toString('base64');
    for (const dump of [JSON.stringify(config), inspect(config, { depth: 10, showHidden: true })]) {
      expect(dump).not.toContain(PASSWORD);
      expect(dump).not.toContain(basic);
      expect(dump).not.toContain(APPLE_ID);
    }
  });

  it('lê a lista de calendários', () => {
    const config = loadCalendarConfig(envWith({ ICLOUD_CALENDARS: ' Pessoal , , Casa ' }), ARGV_ON);
    expect(config.status === 'on' && config.calendarNames).toEqual(['Pessoal', 'Casa']);
    const all = loadCalendarConfig(envWith(), ARGV_ON);
    expect(all.status === 'on' && all.calendarNames).toEqual([]);
  });
});
