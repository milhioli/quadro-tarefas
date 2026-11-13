/** Fonte de "agora" injetável, para que os testes não dependam do relógio real. */
export type Now = () => Date;

export const systemNow: Now = () => new Date();

export function fixedNow(iso: string): Now {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) throw new RangeError(`Data inválida: ${iso}`);
  return () => new Date(time);
}

export function nowIso(now: Now): string {
  return now().toISOString();
}
