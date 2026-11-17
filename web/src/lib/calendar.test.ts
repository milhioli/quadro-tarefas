import { describe, expect, it } from 'vitest';
import {
  addDays,
  brazilianHolidays,
  civilDate,
  currentWorkWeek,
  daysInMonth,
  dayOfWeek,
  easterSunday,
  formatDayHeader,
  formatDayMonth,
  formatLongDate,
  holidayKindLabel,
  holidayLabel,
  holidaysForDates,
  holidaysOn,
  isoDate,
  monthLabel,
  nextHoliday,
  parseIsoDate,
  sameDate,
  toCivilDate,
  weekLabel,
  weekOfMonth,
  weeksInMonth,
} from './calendar';

const d = (iso: string): Date => {
  const date = parseIsoDate(iso);
  if (!date) throw new Error(`data de teste inválida: ${iso}`);
  return date;
};

describe('civilDate e conversões', () => {
  it('cria a meia-noite UTC do dia', () => {
    expect(civilDate(2026, 11, 13).toISOString()).toBe('2026-11-13T00:00:00.000Z');
  });

  it('rejeita datas inexistentes', () => {
    expect(() => civilDate(2026, 2, 29)).toThrow(RangeError);
    expect(() => civilDate(2026, 13, 1)).toThrow(RangeError);
    expect(() => civilDate(2026, 1, 1.5)).toThrow(RangeError);
  });

  it('toCivilDate usa o dia local do instante', () => {
    expect(isoDate(toCivilDate(new Date(2026, 10, 13, 23, 59)))).toBe('2026-11-13');
    expect(isoDate(toCivilDate(new Date(2026, 10, 14, 0, 1)))).toBe('2026-11-14');
  });

  it('isoDate e parseIsoDate fazem ida e volta', () => {
    expect(isoDate(civilDate(2026, 2, 3))).toBe('2026-02-03');
    expect(parseIsoDate('2026-02-03')?.toISOString()).toBe('2026-02-03T00:00:00.000Z');
  });

  it('parseIsoDate rejeita formato ou data inválidos', () => {
    for (const value of ['2026-02-30', '2026-2-3', '13/11/2026', 'abc', '', '2026-11-13T00:00']) {
      expect(parseIsoDate(value)).toBeNull();
    }
  });

  it('addDays, dayOfWeek, sameDate e daysInMonth', () => {
    expect(isoDate(addDays(d('2026-12-31'), 1))).toBe('2027-01-01');
    expect(isoDate(addDays(d('2026-03-01'), -1))).toBe('2026-02-28');
    expect(dayOfWeek(d('2026-11-13'))).toBe(5);
    expect(sameDate(d('2026-11-13'), civilDate(2026, 11, 13))).toBe(true);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 11)).toBe(30);
  });
});

describe('easterSunday', () => {
  it.each([
    [2026, '2026-04-05'],
    [2025, '2025-04-20'],
    [2024, '2024-03-31'],
    [2000, '2000-04-23'],
    [2285, '2285-03-22'],
    [2038, '2038-04-25'],
  ])('Páscoa de %i é %s', (year, expected) => {
    expect(isoDate(easterSunday(year))).toBe(expected);
  });
});

describe('brazilianHolidays', () => {
  it('2026 tem 13 entradas: 10 feriados e 3 pontos facultativos', () => {
    const list = brazilianHolidays(2026);
    expect(list).toHaveLength(13);
    expect(list.filter((h) => h.kind === 'feriado')).toHaveLength(10);
    expect(list.filter((h) => h.kind === 'facultativo')).toHaveLength(3);
  });

  it('2023 tem 12 entradas (ainda sem o 20/11)', () => {
    const list = brazilianHolidays(2023);
    expect(list).toHaveLength(12);
    expect(list.some((h) => isoDate(h.date) === '2023-11-20')).toBe(false);
  });

  it('o 20/11 é feriado a partir de 2024', () => {
    expect(holidaysOn(d('2024-11-20')).map((h) => h.name)).toEqual(['Dia Nacional de Zumbi e da Consciência Negra']);
  });

  it('datas móveis de 2026', () => {
    const byName = (name: string) => brazilianHolidays(2026).filter((h) => h.name === name).map((h) => isoDate(h.date));
    expect(byName('Carnaval')).toEqual(['2026-02-16', '2026-02-17']);
    expect(byName('Sexta-feira Santa')).toEqual(['2026-04-03']);
    expect(byName('Corpus Christi')).toEqual(['2026-06-04']);
  });

  it('feriados fixos de 2026, em ordem', () => {
    const fixed = brazilianHolidays(2026)
      .filter((h) => h.kind === 'feriado' && h.name !== 'Sexta-feira Santa')
      .map((h) => `${isoDate(h.date)} ${h.name}`);
    expect(fixed).toEqual([
      '2026-01-01 Confraternização Universal',
      '2026-04-21 Tiradentes',
      '2026-05-01 Dia do Trabalho',
      '2026-09-07 Independência do Brasil',
      '2026-10-12 Nossa Senhora Aparecida',
      '2026-11-02 Finados',
      '2026-11-15 Proclamação da República',
      '2026-11-20 Dia Nacional de Zumbi e da Consciência Negra',
      '2026-12-25 Natal',
    ]);
  });

  it('a lista vem ordenada por data', () => {
    const times = brazilianHolidays(2026).map((h) => h.date.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('em 21/04/2000 caem dois feriados (Tiradentes e Sexta-feira Santa)', () => {
    expect(holidaysOn(d('2000-04-21')).map((h) => h.name)).toEqual(['Sexta-feira Santa', 'Tiradentes']);
  });

  it('carnaval e Corpus Christi são pontos facultativos', () => {
    expect(holidaysOn(d('2026-02-16'))).toEqual([expect.objectContaining({ name: 'Carnaval', kind: 'facultativo' })]);
    expect(holidaysOn(d('2026-06-04'))).toEqual([expect.objectContaining({ name: 'Corpus Christi', kind: 'facultativo' })]);
  });

  it('dia comum não tem feriado', () => {
    expect(holidaysOn(d('2026-11-13'))).toEqual([]);
  });
});

describe('semanas do mês', () => {
  it.each([
    [2026, 11, 5],
    [2026, 2, 4],
    [2026, 5, 6],
    [2026, 8, 6],
    [2027, 2, 5],
  ])('weeksInMonth(%i, %i) = %i', (year, month, expected) => {
    expect(weeksInMonth(year, month)).toBe(expected);
  });

  it.each([
    ['2026-11-13', 2],
    ['2026-11-29', 5],
    ['2026-11-01', 1],
    ['2026-08-02', 2],
  ])('weekOfMonth(%s) = %i', (iso, expected) => {
    expect(weekOfMonth(d(iso))).toBe(expected);
  });

  it('weekLabel', () => {
    expect(weekLabel(d('2026-11-13'))).toBe('Semana 2 de 5');
  });
});

describe('currentWorkWeek', () => {
  const week = (iso: string) => currentWorkWeek(d(iso)).map(isoDate);

  it('sexta 13/11/2026 → 09 a 13/11', () => {
    expect(week('2026-11-13')).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']);
  });

  it('domingo mostra a semana que começa', () => {
    expect(week('2026-11-15')).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']);
  });

  it('sábado mostra a semana que termina', () => {
    expect(week('2026-11-14')).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']);
  });

  it('quinta 31/12/2026 → 28/12 a 01/01/2027', () => {
    expect(week('2026-12-31')).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01']);
  });
});

describe('holidaysForDates', () => {
  it('cobre semanas que atravessam o ano novo', () => {
    const map = holidaysForDates(currentWorkWeek(d('2026-12-31')));
    expect(map.get('2027-01-01')?.map((h) => h.name)).toEqual(['Confraternização Universal']);
    expect(map.get('2026-12-28')).toEqual([]);
    expect(map.size).toBe(5);
  });

  it('a semana de 16 a 20/11/2026 tem a Consciência Negra na sexta', () => {
    const map = holidaysForDates(currentWorkWeek(d('2026-11-15')));
    expect(map.get('2026-11-20')?.map((h) => h.name)).toEqual(['Dia Nacional de Zumbi e da Consciência Negra']);
  });
});

describe('nextHoliday', () => {
  it('é estritamente depois da data', () => {
    expect(nextHoliday(d('2026-11-13'))?.name).toBe('Proclamação da República');
    expect(isoDate(nextHoliday(d('2026-11-15'))?.date ?? d('1970-01-01'))).toBe('2026-11-20');
  });

  it('olha o ano seguinte', () => {
    const next = nextHoliday(d('2026-12-25'));
    expect(next && isoDate(next.date)).toBe('2027-01-01');
    expect(next?.name).toBe('Confraternização Universal');
  });

  it('inclui pontos facultativos', () => {
    expect(nextHoliday(d('2026-02-01'))).toEqual(expect.objectContaining({ name: 'Carnaval', kind: 'facultativo' }));
  });
});

describe('rótulos de feriado', () => {
  it('holidayKindLabel e holidayLabel', () => {
    expect(holidayKindLabel('feriado')).toBe('Feriado');
    expect(holidayKindLabel('facultativo')).toBe('Ponto facultativo');
    expect(holidayLabel({ date: d('2026-11-15'), name: 'Proclamação da República', kind: 'feriado' })).toBe(
      'Feriado: Proclamação da República (15/11)',
    );
    expect(holidayLabel({ date: d('2026-02-16'), name: 'Carnaval', kind: 'facultativo' })).toBe(
      'Ponto facultativo: Carnaval (16/02)',
    );
  });
});

describe('formatação em pt-BR', () => {
  it('monthLabel', () => {
    expect(monthLabel(d('2026-11-13'))).toBe('Novembro de 2026');
    expect(monthLabel(d('2026-03-01'))).toBe('Março de 2026');
  });

  it('formatDayHeader, formatLongDate e formatDayMonth', () => {
    expect(formatDayHeader(d('2026-11-09'))).toBe('Seg 09/11');
    expect(formatDayHeader(d('2026-11-13'))).toBe('Sex 13/11');
    expect(formatLongDate(d('2026-11-13'))).toBe('sexta-feira, 13/11');
    expect(formatLongDate(d('2026-11-15'))).toBe('domingo, 15/11');
    expect(formatDayMonth(d('2027-01-01'))).toBe('01/01');
  });
});
