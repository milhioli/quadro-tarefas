/** Quantidade de linhas do quadro: 05:00 – 05:30 até 21:30 – 22:00. */
export const SLOT_COUNT = 34;
/** Início do primeiro bloco, em minutos desde 00:00 (05:00). */
export const SLOT_START_MINUTES = 5 * 60;
/** Duração de cada bloco, em minutos. */
export const SLOT_MINUTES = 30;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatMinutes(totalMinutes: number): string {
  return `${pad2(Math.floor(totalMinutes / 60))}:${pad2(totalMinutes % 60)}`;
}

export function isValidSlot(slot: unknown): slot is number {
  return typeof slot === 'number' && Number.isInteger(slot) && slot >= 0 && slot < SLOT_COUNT;
}

/** Rótulo do bloco, ex.: slotLabel(0) === '05:00 – 05:30' (travessão U+2013). */
export function slotLabel(slot: number): string {
  if (!isValidSlot(slot)) {
    throw new RangeError(`Horário inválido: ${String(slot)}`);
  }
  const start = SLOT_START_MINUTES + slot * SLOT_MINUTES;
  return `${formatMinutes(start)} – ${formatMinutes(start + SLOT_MINUTES)}`;
}

export const SLOTS: readonly string[] = Object.freeze(
  Array.from({ length: SLOT_COUNT }, (_, slot) => slotLabel(slot)),
);
