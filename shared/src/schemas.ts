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

/** Duração em slots de 30 min: de 1 até o dia inteiro do quadro (05:00 – 22:00). */
export const spanSchema = z
  .number({ error: 'Duração inválida' })
  .int({ error: 'Duração inválida' })
  .min(1, { error: 'A duração mínima é de 30 minutos' })
  .max(SLOT_COUNT, { error: 'A duração máxima vai de 05:00 a 22:00' });

/**
 * `position` em criação/edição: ao contrário do arraste (PUT position, que
 * troca), aqui uma faixa que cruza outra tarefa é recusada com 409. O mesmo
 * vale para `span` que cresce sobre a tarefa de baixo.
 */
export const createTaskSchema = z.strictObject({
  title: titleSchema,
  color: colorSchema.optional(),
  content: richDocSchema.optional(),
  span: spanSchema.optional(),
  position: moveTargetSchema.optional(),
});

export const updateTaskSchema = z
  .strictObject({
    title: titleSchema.optional(),
    color: colorSchema.optional(),
    content: richDocSchema.optional(),
    span: spanSchema.optional(),
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
  /** Primeiro slot: 0 = 05:00 – 05:30 … 33 = 21:30 – 22:00; null quando está no deck. */
  slot: number | null;
  /** Quantos slots seguidos a tarefa ocupa (1 a 34). Vale também no deck. */
  span: number;
  /** Ordem no deck; null quando a tarefa está no quadro. */
  deckOrder: number | null;
  /** Quadro (pessoal ou de grupo) a que a tarefa pertence. Nunca muda. */
  boardId: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskListResponse {
  tasks: Task[];
}

// ---------- Contas, quadros e convites ----------

/**
 * Controles e formatação invisível (inclui os de direção, como U+202E, que
 * invertem visualmente o texto ao lado). Proibidos em nomes que outras pessoas
 * leem, para um nome não se disfarçar de outro handle.
 */
const HIDDEN_CHARACTERS = /[\p{Cc}\p{Cf}]/u;

export const USERNAME_PATTERN = /^[a-z0-9._]{3,20}$/;
export const RESERVED_USERNAMES: readonly string[] = Object.freeze(['admin', 'suporte', 'quadro', 'root', 'sistema']);
export const DISPLAY_NAME_MAX_LENGTH = 40;
export const BOARD_NAME_MAX_LENGTH = 60;

export const usernameSchema = z
  .string({ error: 'Informe um nome de usuário' })
  .trim()
  .toLowerCase()
  .regex(USERNAME_PATTERN, 'Use de 3 a 20 letras minúsculas, números, ponto ou sublinhado')
  .refine((value) => !RESERVED_USERNAMES.includes(value), { error: 'Esse nome de usuário é reservado' });

function visibleText(label: string, max: number) {
  return z
    .string({ error: `Informe ${label}` })
    .trim()
    .min(1, `Informe ${label}`)
    .max(max, `Use no máximo ${max} caracteres`)
    .refine((value) => !HIDDEN_CHARACTERS.test(value), { error: 'Use só caracteres visíveis' });
}

export const displayNameSchema = visibleText('um nome de exibição', DISPLAY_NAME_MAX_LENGTH);
export const boardNameSchema = visibleText('um nome para o quadro', BOARD_NAME_MAX_LENGTH);

/** Handle público: `ana_07`, `ana_100`. O número tem pelo menos 2 dígitos. */
export function formatHandle(username: string, seq: number): string {
  return `${username}_${String(seq).padStart(2, '0')}`;
}

/** Lê um handle na forma canônica (a que `formatHandle` produz), ou null. */
export function parseHandle(raw: string): { username: string; seq: number } | null {
  const match = /^([a-z0-9._]{3,20})_(\d{2,15})$/.exec(raw.trim().toLowerCase());
  if (!match) return null;
  const username = match[1] as string;
  const seq = Number(match[2]);
  return formatHandle(username, seq) === `${username}_${match[2]}` ? { username, seq } : null;
}

export const handleSchema = z
  .string({ error: 'Informe o nome de usuário com o número (ex.: ana_07)' })
  .transform((value, context) => {
    const parsed = parseHandle(value);
    if (!parsed) {
      context.addIssue({ code: 'custom', message: 'Use o nome de usuário com o número (ex.: ana_07)' });
      return z.NEVER;
    }
    return parsed;
  });

export const profileInputSchema = z.strictObject({ username: usernameSchema, displayName: displayNameSchema });
export const boardInputSchema = z.strictObject({ name: boardNameSchema });
export const inviteInputSchema = z.strictObject({ handle: handleSchema });

/** Login de desenvolvimento (só no entrypoint de E2E): e-mails de teste, nada mais. */
export const devLoginSchema = z.strictObject({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .regex(/^[a-z0-9._%+-]{1,64}@example\.com$/, 'Use um e-mail @example.com'),
});

/** `:id` e `:boardId`/`:userId` nas rotas: inteiro positivo em decimal. */
const positiveIdSchema = z
  .string()
  .regex(/^[1-9]\d{0,14}$/, 'Identificador inválido')
  .transform((value) => Number(value));
export const boardIdParamsSchema = z.strictObject({ boardId: positiveIdSchema });
export const memberParamsSchema = z.strictObject({ boardId: positiveIdSchema, userId: positiveIdSchema });

export type UserRole = 'admin' | 'user';
export type BoardKind = 'personal' | 'group';
export type MemberRole = 'owner' | 'editor';
export type MemberStatus = 'invited' | 'active';

export interface MeUser {
  id: number;
  handle: string;
  displayName: string;
  role: UserRole;
  /** O quadro pessoal (o "Meu quadro"). */
  personalBoardId: number;
}

export interface MeResponse {
  /** null sem sessão ou enquanto o perfil não foi criado. */
  user: MeUser | null;
  /** Sessão sem perfil ainda (primeiro acesso): sugestão para o nome de exibição. */
  pendingProfile: { suggestedName: string } | null;
}

export interface AuthMethods {
  google: boolean;
  dev: boolean;
}

export interface BoardSummary {
  id: number;
  name: string;
  kind: BoardKind;
  role: MemberRole;
}

export interface BoardListResponse {
  boards: BoardSummary[];
}

export interface Member {
  userId: number;
  handle: string;
  displayName: string;
  role: MemberRole;
  status: MemberStatus;
}

export interface MemberListResponse {
  members: Member[];
}

export interface Invite {
  boardId: number;
  boardName: string;
  /** Handle de quem convidou (null se a conta não existe mais). */
  invitedBy: string | null;
}

export interface InviteListResponse {
  invites: Invite[];
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
  | 'UNAUTHENTICATED'
  | 'NEEDS_USERNAME'
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
