export const TASK_COLORS = Object.freeze([
  'amarelo',
  'azul',
  'verde',
  'rosa',
  'roxo',
  'laranja',
  'cinza',
] as const);

export type TaskColor = (typeof TASK_COLORS)[number];

export const DEFAULT_COLOR: TaskColor = 'amarelo';

export const COLOR_LABELS: Readonly<Record<TaskColor, string>> = Object.freeze({
  amarelo: 'Amarelo',
  azul: 'Azul',
  verde: 'Verde',
  rosa: 'Rosa',
  roxo: 'Roxo',
  laranja: 'Laranja',
  cinza: 'Cinza',
});

export function isTaskColor(value: unknown): value is TaskColor {
  return typeof value === 'string' && (TASK_COLORS as readonly string[]).includes(value);
}
