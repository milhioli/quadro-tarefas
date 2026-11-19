import {
  expect,
  test as base,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { BASE_URL } from './ports';

/** Origem do projeto em execução: o Vite (desktop e mobile) ou o Fastify com o build (producao). */
export function appOrigin(): string {
  return new URL(base.info().project.use.baseURL ?? BASE_URL).origin;
}

/**
 * Headers obrigatórios em toda mutação pela API: o do cliente (mesmo valor de
 * CLIENT_HEADER em @quadro/shared) e o Origin do projeto, que o navegador manda
 * sozinho mas o request do Playwright não.
 */
export function clientHeaders(): Record<string, string> {
  return { 'X-Quadro-Client': '1', Origin: appOrigin() };
}

export const DAY_NAMES = Object.freeze(['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'] as const);

export interface ApiTask {
  id: number;
  title: string;
  day: number | null;
  slot: number | null;
  span: number;
  boardId: number;
}

export type CellPosition = { kind: 'cell'; day: number; slot: number };

/** Conta de teste logada (login de desenvolvimento do `npm run dev:e2e`). */
export interface E2eAccount {
  email: string;
  userId: number;
  handle: string;
  displayName: string;
  /** Quadro pessoal: cada teste tem o seu, então começa vazio. */
  boardId: number;
}

export interface E2eProfile {
  username: string;
  displayName: string;
}

export const DEFAULT_PROFILE: E2eProfile = Object.freeze({ username: 'teste.e2e', displayName: 'Teste E2E' });

/** "05:00 – 05:30" para o slot 0 (travessão U+2013), como em shared/src/slots.ts. */
export function slotLabel(slot: number): string {
  const time = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const start = 5 * 60 + slot * 30;
  return `${time(start)} – ${time(start + 30)}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * E-mail único por teste, repetição e pessoa. O login de teste só aceita
 * `@example.com`, e a conta nova garante um quadro pessoal vazio.
 */
export function accountEmail(testInfo: TestInfo, label = 'a'): string {
  return `e2e-${label}-${testInfo.testId}-${testInfo.repeatEachIndex}-${testInfo.retry}@example.com`.toLowerCase();
}

/** Entra pelo login de teste e cria o perfil. O `request` guarda o cookie da sessão. */
export async function signIn(
  request: APIRequestContext,
  email: string,
  profile: E2eProfile = DEFAULT_PROFILE,
): Promise<E2eAccount> {
  const login = await request.post('/api/auth/dev/login', { headers: clientHeaders(), data: { email } });
  expect(login.status(), 'login de teste').toBe(200);
  let me = (await login.json()) as { user: { id: number; handle: string; displayName: string; personalBoardId: number } | null };
  if (!me.user) {
    const created = await request.post('/api/me/profile', { headers: clientHeaders(), data: profile });
    expect(created.status(), 'perfil de teste').toBe(200);
    me = (await created.json()) as typeof me;
  }
  const user = me.user;
  if (!user) throw new Error('perfil de teste sem usuário');
  return { email, userId: user.id, handle: user.handle, displayName: user.displayName, boardId: user.personalBoardId };
}

async function personalBoardId(request: APIRequestContext): Promise<number> {
  const response = await request.get('/api/me');
  expect(response.status()).toBe(200);
  const me = (await response.json()) as { user: { personalBoardId: number } | null };
  if (!me.user) throw new Error('sem sessão: use a fixture `account`');
  return me.user.personalBoardId;
}

/** Tarefas de um quadro (padrão: o pessoal de quem está logado). */
export async function listTasks(request: APIRequestContext, boardId?: number): Promise<ApiTask[]> {
  const board = boardId ?? (await personalBoardId(request));
  const response = await request.get(`/api/boards/${board}/tasks`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { tasks: ApiTask[] }).tasks;
}

/** Cria pela API pública (sem rota "só para teste"), no quadro pessoal por padrão. */
export async function createTask(
  request: APIRequestContext,
  input: { title: string; position?: CellPosition; span?: number },
  boardId?: number,
): Promise<ApiTask> {
  const board = boardId ?? (await personalBoardId(request));
  const response = await request.post(`/api/boards/${board}/tasks`, { headers: clientHeaders(), data: input });
  expect(response.status()).toBe(201);
  return (await response.json()) as ApiTask;
}

export function boardRegion(page: Page): Locator {
  return page.getByRole('region', { name: 'Quadro da semana' });
}

export function deckRegion(page: Page): Locator {
  return page.getByRole('region', { name: /^Tarefas \(\d+\)$/ });
}

/** Célula do quadro: dia 0 = segunda; o nome acessível é "Segunda 16/11, 05:00 – 05:30". */
export function boardCell(page: Page, day: number, slot: number): Locator {
  const name = new RegExp(`^${DAY_NAMES[day]} \\d{2}/\\d{2}, ${escapeRegExp(slotLabel(slot))}$`);
  return boardRegion(page).getByRole('cell', { name });
}

/** Cartão de tarefa (o nome começa pelo título; o progresso do checklist vem depois). */
export function taskCard(scope: Page | Locator, title: string): Locator {
  return scope.getByRole('button', { name: new RegExp(`^${escapeRegExp(title)}`) });
}

/** Aviso do App (o dnd-kit também cria um role="status", por isso a classe). */
export function notice(page: Page): Locator {
  return page.locator('.notice');
}

/** Seletor do quadro aberto, na barra da sessão. */
export function boardSelect(page: Page): Locator {
  return page.getByRole('combobox', { name: 'Quadro' });
}

async function centerOf(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Elemento sem caixa visível para arrastar');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Arraste real com o mouse. O PointerSensor só começa depois de 5 px
 * (POINTER_ACTIVATION), então o primeiro movimento é curto e o resto vai em passos.
 */
export async function dragTo(page: Page, source: Locator, target: Locator): Promise<void> {
  const from = await centerOf(source);
  const to = await centerOf(target);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 12, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 15 });
  await page.mouse.up();
}

export interface ConsoleWatch {
  /**
   * Erro de console esperado neste teste. Ex.: o Chromium registra toda
   * resposta 409 como "Failed to load resource", mesmo quando o 409 é a regra.
   */
  allow(pattern: RegExp): void;
}

/** Linha que o Chromium escreve no console para uma resposta HTTP com esse status. */
export function httpStatusConsoleError(status: number): RegExp {
  return new RegExp(`status of ${status}\\b`);
}

/** Junta os erros de console e de página de uma aba. */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** Outra pessoa, num navegador separado (contexto com cookies próprios), já logada. */
export interface OtherPerson {
  context: BrowserContext;
  page: Page;
  account: E2eAccount;
  consoleErrors: string[];
}

export async function openAs(browser: Browser, testInfo: TestInfo, label: string, profile: E2eProfile): Promise<OtherPerson> {
  const project = testInfo.project.use;
  const context = await browser.newContext({
    baseURL: project.baseURL ?? BASE_URL,
    locale: project.locale,
    timezoneId: project.timezoneId,
    viewport: project.viewport,
  });
  const account = await signIn(context.request, accountEmail(testInfo, label), profile);
  const page = await context.newPage();
  return { context, page, account, consoleErrors: collectConsoleErrors(page) };
}

/**
 * Fixtures de todo teste:
 * - `request` é o da página: a sessão (cookie) é a mesma do navegador;
 * - `account` entra com uma conta nova (e-mail único), então o quadro pessoal
 *   começa vazio. `test.use({ loggedIn: false })` começa sem sessão;
 * - falha se aparecer erro no console ou erro não tratado na página (inclui CSP e React),
 *   a não ser os que o teste declarou com `consoleErrors.allow(...)`.
 */
export const test = base.extend<{ loggedIn: boolean; account: E2eAccount | null; consoleErrors: ConsoleWatch }>({
  loggedIn: [true, { option: true }],
  request: async ({ page }, use) => {
    await use(page.request);
  },
  account: [
    async ({ loggedIn, request }, use, testInfo) => {
      await use(loggedIn ? await signIn(request, accountEmail(testInfo)) : null);
    },
    { auto: true },
  ],
  consoleErrors: [
    async ({ page }, use) => {
      const errors = collectConsoleErrors(page);
      const allowed: RegExp[] = [];
      await use({ allow: (pattern) => void allowed.push(pattern) });
      const unexpected = errors.filter((text) => !allowed.some((pattern) => pattern.test(text)));
      expect(unexpected, 'erros no console do navegador').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
