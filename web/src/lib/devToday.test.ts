import { describe, expect, it } from 'vitest';
import { isoDate, toCivilDate } from './calendar';
import { fixedClock } from './clock';
import { devTodayFromSearch, resolveClock } from './devToday';

const base = fixedClock('2026-11-13T15:00:00.000Z');

describe('devTodayFromSearch', () => {
  it('lê a data do parâmetro hoje', () => {
    expect(isoDate(devTodayFromSearch('?hoje=2026-11-15') as Date)).toBe('2026-11-15');
    expect(isoDate(devTodayFromSearch('?x=1&hoje=2026-02-15') as Date)).toBe('2026-02-15');
  });

  it('devolve null se ausente ou inválido', () => {
    expect(devTodayFromSearch('')).toBeNull();
    expect(devTodayFromSearch('?hoje=')).toBeNull();
    expect(devTodayFromSearch('?hoje=2026-02-30')).toBeNull();
    expect(devTodayFromSearch('?hoje=amanha')).toBeNull();
  });
});

describe('resolveClock', () => {
  it('fora de dev ignora o parâmetro', () => {
    expect(resolveClock('?hoje=2026-11-15', false, base)).toBe(base);
  });

  it('em dev sem parâmetro válido usa o relógio base', () => {
    expect(resolveClock('', true, base)).toBe(base);
    expect(resolveClock('?hoje=2026-13-01', true, base)).toBe(base);
  });

  it('em dev fixa o relógio ao meio-dia local da data pedida', () => {
    const clock = resolveClock('?hoje=2026-12-31', true, base);
    const now = clock();
    expect(isoDate(toCivilDate(now))).toBe('2026-12-31');
    expect(now.getHours()).toBe(12);
    expect(clock()).not.toBe(now);
    expect(clock().getTime()).toBe(now.getTime());
  });
});
