import { SLOTS, maxSpanAt, occupantOf, slotTime, spanDurationLabel, type Task } from '@quadro/shared';
import type { BoardColumn } from './board';

/** As três visualizações da agenda mobile, na ordem das tags. */
export const AGENDA_VIEWS = Object.freeze([
  { id: 'day', label: 'Dia', description: 'Só os horários ocupados do dia' },
  { id: 'dayFull', label: 'Dia completo', description: 'Todos os horários do dia, com os livres' },
  { id: 'week', label: 'Semana', description: 'A semana inteira em lista' },
] as const);

export type AgendaView = (typeof AGENDA_VIEWS)[number]['id'];

export const DEFAULT_AGENDA_VIEW: AgendaView = 'day';
export const AGENDA_VIEW_STORAGE_KEY = 'quadro-tarefas:visualizacao';

const VIEW_IDS: readonly string[] = AGENDA_VIEWS.map((view) => view.id);

/**
 * Lista fechada: só os três ids conhecidos passam. A origem 127.0.0.1:5173 é
 * compartilhada com outros projetos Vite, então o valor salvo pode ser
 * qualquer coisa (inclusive "toString" ou "__proto__").
 */
export function parseAgendaView(value: unknown): AgendaView {
  return typeof value === 'string' && VIEW_IDS.includes(value) ? (value as AgendaView) : DEFAULT_AGENDA_VIEW;
}

export type StorageGetter = () => Pick<Storage, 'getItem' | 'setItem'>;

/** O próprio acesso a window.localStorage pode lançar (SecurityError), por isso é uma função. */
export const browserStorage: StorageGetter = () => window.localStorage;

/** Preferência por navegador. Se o storage falhar, usa a visualização padrão. */
export function loadAgendaView(getStorage: StorageGetter): AgendaView {
  try {
    return parseAgendaView(getStorage().getItem(AGENDA_VIEW_STORAGE_KEY));
  } catch {
    return DEFAULT_AGENDA_VIEW;
  }
}

export function saveAgendaView(getStorage: StorageGetter, view: AgendaView): void {
  try {
    getStorage().setItem(AGENDA_VIEW_STORAGE_KEY, view);
  } catch {
    // Só conveniência: sem storage, a escolha vale até recarregar.
  }
}

/** Tarefas agendadas no dia, em ordem de horário. */
export function tasksForDay(tasks: readonly Task[], day: number): Task[] {
  return tasks
    .filter((task) => task.day === day && task.slot !== null)
    .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0) || a.id - b.id);
}

/** Aba inicial: hoje, se estiver na semana mostrada; senão, segunda. */
export function defaultAgendaDay(columns: readonly BoardColumn[]): number {
  return columns.find((column) => column.isToday)?.day ?? 0;
}

export interface SlotChoice {
  slot: number;
  label: string;
  /** Outra tarefa que já ocupa o horário (a própria tarefa não conta). */
  occupant: Task | undefined;
}

/**
 * Os 34 horários do dia para o seletor do modal, com quem ocupa cada um
 * (inclusive um horário só coberto pela faixa de outra tarefa).
 */
export function slotChoices(tasks: readonly Task[], day: number, selfId?: number): SlotChoice[] {
  return SLOTS.map((label, slot) => ({ slot, label, occupant: occupantOf(tasks, day, slot, selfId) }));
}

export interface EndChoice {
  span: number;
  /** "06:30 (1 h 30)". */
  label: string;
}

/**
 * Fins possíveis ("Até") para uma tarefa que começa em `slot`: do fim do
 * próprio slot até o início da próxima tarefa do dia, ou até 22:00.
 */
export function endChoices(tasks: readonly Task[], day: number, slot: number, selfId?: number): EndChoice[] {
  const max = maxSpanAt(tasks, day, slot, selfId);
  return Array.from({ length: max }, (_, index) => {
    const span = index + 1;
    return { span, label: `${slotTime(slot + span)} (${spanDurationLabel(span)})` };
  });
}

/** O maior span que cabe a partir de (day, slot), no mínimo 1. */
export function clampSpan(tasks: readonly Task[], day: number, slot: number, span: number, selfId?: number): number {
  return Math.max(1, Math.min(span, maxSpanAt(tasks, day, slot, selfId)));
}
