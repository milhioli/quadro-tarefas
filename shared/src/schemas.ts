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

export const createTaskSchema = z.strictObject({
  title: titleSchema,
  color: colorSchema.optional(),
  content: richDocSchema.optional(),
});

export const updateTaskSchema = z
  .strictObject({
    title: titleSchema.optional(),
    color: colorSchema.optional(),
    content: richDocSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { error: 'Nada para atualizar' });

export const moveTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('deck') }),
  z.strictObject({
    kind: z.literal('cell'),
    day: z.number().int().min(0).max(DAY_COUNT - 1),
    slot: z.number().int().min(0).max(SLOT_COUNT - 1),
  }),
]);

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

export type ApiErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
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
