/**
 * Fonte de "agora" injetável. É o único lugar do frontend que lê o relógio
 * real; o resto recebe um `Clock`, para que os testes usem datas fixas.
 */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

export function fixedClock(value: string | Date): Clock {
  const time = typeof value === 'string' ? Date.parse(value) : value.getTime();
  if (Number.isNaN(time)) throw new RangeError(`Data inválida: ${String(value)}`);
  return () => new Date(time);
}
