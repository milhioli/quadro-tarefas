/** Colunas do quadro: segunda (0) a sexta (4). */
export const DAY_COUNT = 5;

export const DAY_NAMES = Object.freeze(['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'] as const);
export const DAY_SHORT_NAMES = Object.freeze(['Seg', 'Ter', 'Qua', 'Qui', 'Sex'] as const);

export const DAYS: readonly number[] = Object.freeze(Array.from({ length: DAY_COUNT }, (_, day) => day));

export function isValidDay(day: unknown): day is number {
  return typeof day === 'number' && Number.isInteger(day) && day >= 0 && day < DAY_COUNT;
}

export function dayName(day: number): string {
  if (!isValidDay(day)) {
    throw new RangeError(`Dia inválido: ${String(day)}`);
  }
  return DAY_NAMES[day] as string;
}
