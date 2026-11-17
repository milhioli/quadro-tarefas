import { z } from 'zod';
import { TASK_COLORS, type TaskColor } from './colors';
import { DAY_COUNT } from './days';
import { validateRichDoc, type RichDoc } from './richDoc';
import { SLOT_COUNT } from './slots';

export const TITLE_MAX_LENGTH = 120;

export const titleSchema = z
  .string({ error: 'Informe um título' })
  .trim()
  .min(1, 'Informe um título')
  .max(TITLE_MAX_LENGTH, `O título deve ter no máximo ${TITLE_MAX_LENGTH} caracteres`);

export const colorSchema = z.enum(TASK_COLORS, { error: 'Cor inválida' });

export const richDocSchema = z.custom<RichDoc>((value) => validateRichDoc(value) === null, {
  error: 'Conteúdo da tarefa inválido',
});

/** Destino de uma tarefa: o deck ou uma célula (dia 0–4, horário 0–33). */
export const moveTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('deck') }),
  z.strictObject({
    kind: z.literal('cell'),
    day: z.number().int().min(0).max(DAY_COUNT - 1),
    slot: z.number().int().min(0).max(SLOT_COUNT - 1),
  }),
]);

/**
 * `position` em criação/edição: ao contrário do arraste (PUT position, que
 * troca), aqui uma célula ocupada por outra tarefa é recusada com 409.
 */
export const createTaskSchema = z.strictObject({
  title: titleSchema,
  color: colorSchema.optional(),
  content: richDocSchema.optional(),
  position: moveTargetSchema.optional(),
});

export const updateTaskSchema = z
  .strictObject({
    title: titleSchema.optional(),
    color: colorSchema.optional(),
    content: richDocSchema.optional(),
    position: moveTargetSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { error: 'Nada para atualizar' });

export const moveBodySchema = z.strictObject({ to: moveTargetSchema });

/** `:id` da rota: inteiro positivo em decimal, sem sinal, expoente ou zeros à esquerda. */
export const taskIdParamsSchema = z.strictObject({
  id: z
    .string()
    .regex(/^[1-9]\d{0,14}$/, 'Identificador inválido')
    .transform((value) => Number(value)),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type MoveTarget = z.infer<typeof moveTargetSchema>;

export interface Task {
  id: number;
  title: string;
  color: TaskColor;
  content: RichDoc;
  /** 0 = segunda … 4 = sexta; null quando a tarefa está no deck. */
  day: number | null;
  /** 0 = 05:00 – 05:30 … 33 = 21:30 – 22:00; null quando está no deck. */
  slot: number | null;
  /** Ordem no deck; null quando a tarefa está no quadro. */
  deckOrder: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskListResponse {
  tasks: Task[];
}

export interface ResetResponse {
  tasks: Task[];
  moved: number;
}

// ---------- Agenda da Apple (somente leitura) ----------

/**
 * Evento da agenda, já minimizado pelo servidor: só título e horário.
 * Com hora: `start`/`end` são instantes ISO (UTC). Dia inteiro: `AAAA-MM-DD`,
 * com `end` exclusivo (como o DTEND do iCalendar).
 */
export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
}

export interface CalendarWeekResponse {
  /** false quando a integração não foi ligada (sem --agenda ou sem senha de app). */
  enabled: boolean;
  events: CalendarEvent[];
}

/** AAAA-MM-DD que existe no calendário e cai numa segunda-feira. */
export function isMondayIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCDay() === 1
  );
}

export const calendarWeekQuerySchema = z.strictObject({
  week: z
    .string({ error: 'Informe a semana' })
    .refine(isMondayIsoDate, { error: 'A semana deve ser uma segunda-feira no formato AAAA-MM-DD' }),
});

export type ApiErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UPSTREAM'
  | 'UPSTREAM_AUTH'
  | 'FORBIDDEN'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'INTERNAL';

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    issues?: Array<{ path: string; message: string }>;
  };
}

/** Header obrigatório em toda mutação (força preflight e bloqueia CSRF). */
export const CLIENT_HEADER = 'X-Quadro-Client';
export const CLIENT_HEADER_VALUE = '1';
