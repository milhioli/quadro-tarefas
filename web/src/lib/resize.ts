/**
 * Duração depois de puxar a borda de baixo do cartão: anda de slot em slot
 * (arredondando para o mais próximo) e fica entre 1 e `maxSpan`.
 */
export function spanFromPointer(
  startY: number,
  currentY: number,
  rowHeight: number,
  startSpan: number,
  maxSpan: number,
): number {
  if (!(rowHeight > 0) || !Number.isFinite(startY) || !Number.isFinite(currentY)) return startSpan;
  const next = startSpan + Math.round((currentY - startY) / rowHeight);
  return Math.min(Math.max(next, 1), Math.max(maxSpan, 1));
}
