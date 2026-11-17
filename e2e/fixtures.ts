import { expect, test as base, type APIRequestContext, type Locator, type Page } from '@playwright/test';

/** Header obrigatório em toda mutação (mesmo valor de CLIENT_HEADER em @quadro/shared). */
export const CLIENT_HEADERS = Object.freeze({ 'X-Quadro-Client': '1' });

export const DAY_NAMES = Object.freeze(['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'] as const);

export interface ApiTask {
  id: number;
  title: string;
  day: number | null;
  slot: number | null;
}

export type CellPosition = { kind: 'cell'; day: number; slot: number };

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

export async function listTasks(request: APIRequestContext): Promise<ApiTask[]> {
  const response = await request.get('/api/tasks');
  expect(response.status()).toBe(200);
  return ((await response.json()) as { tasks: ApiTask[] }).tasks;
}

export async function createTask(
  request: APIRequestContext,
  input: { title: string; position?: CellPosition },
): Promise<ApiTask> {
  const response = await request.post('/api/tasks', { headers: CLIENT_HEADERS, data: input });
  expect(response.status()).toBe(201);
  return (await response.json()) as ApiTask;
}

/** O banco do E2E é temporário: cada teste começa com ele vazio. */
export async function deleteAllTasks(request: APIRequestContext): Promise<void> {
  for (const task of await listTasks(request)) {
    const response = await request.delete(`/api/tasks/${task.id}`, { headers: CLIENT_HEADERS });
    expect(response.status()).toBe(204);
  }
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

/**
 * Fixtures automáticas de todo teste:
 * - começa com o banco vazio;
 * - falha se aparecer erro no console ou erro não tratado na página (inclui CSP e React),
 *   a não ser os que o teste declarou com `consoleErrors.allow(...)`.
 */
export const test = base.extend<{ cleanDatabase: void; consoleErrors: ConsoleWatch }>({
  cleanDatabase: [
    async ({ request }, use) => {
      await deleteAllTasks(request);
      await use();
    },
    { auto: true },
  ],
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      const allowed: RegExp[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('pageerror', (error) => errors.push(error.message));
      await use({ allow: (pattern) => void allowed.push(pattern) });
      const unexpected = errors.filter((text) => !allowed.some((pattern) => pattern.test(text)));
      expect(unexpected, 'erros no console do navegador').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
