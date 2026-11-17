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

/** Duração de uma tarefa em slots: de 1 (30 min) até o dia inteiro do quadro. */
export function isValidSpan(span: unknown): span is number {
  return typeof span === 'number' && Number.isInteger(span) && span >= 1 && span <= SLOT_COUNT;
}

/**
 * Hora de uma fronteira entre slots: 0 → '05:00', 1 → '05:30', 34 → '22:00'.
 * A fronteira `n` é o início do slot `n` (ou o fim do último, em 34).
 */
export function slotTime(boundary: number): string {
  if (!Number.isInteger(boundary) || boundary < 0 || boundary > SLOT_COUNT) {
    throw new RangeError(`Fronteira de horário inválida: ${String(boundary)}`);
  }
  return formatMinutes(SLOT_START_MINUTES + boundary * SLOT_MINUTES);
}

/** Faixa de uma tarefa, ex.: rangeLabel(0, 30) === '05:00 – 20:00'. Com span 1 é igual a slotLabel. */
export function rangeLabel(slot: number, span: number): string {
  if (!isValidSlot(slot) || !isValidSpan(span) || slot + span > SLOT_COUNT) {
    throw new RangeError(`Faixa inválida: ${String(slot)} + ${String(span)}`);
  }
  return `${slotTime(slot)} – ${slotTime(slot + span)}`;
}

/** Duração legível: 1 → '30 min', 2 → '1 h', 3 → '1 h 30'. */
export function spanDurationLabel(span: number): string {
  if (!isValidSpan(span)) throw new RangeError(`Duração inválida: ${String(span)}`);
  const minutes = span * SLOT_MINUTES;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest}`;
}
