import {
  boardCell,
  createTask,
  dragTo,
  expect,
  httpStatusConsoleError,
  listTasks,
  notice,
  taskCard,
  test,
  type ApiTask,
} from './fixtures';

// Fase 1 do docs/roteiro.md: tarefas com duração (span = slots de 30 min seguidos).

async function createSpanTask(
  request: Parameters<typeof createTask>[0],
  title: string,
  day: number,
  slot: number,
  span: number,
): Promise<ApiTask> {
  const response = await request.post('/api/tasks', {
    headers: { 'X-Quadro-Client': '1' },
    data: { title, span, position: { kind: 'cell', day, slot } },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as ApiTask;
}

const byTitle = async (request: Parameters<typeof listTasks>[0], title: string) =>
  (await listTasks(request)).find((task) => task.title === title) as (ApiTask & { span: number }) | undefined;

test('cria uma tarefa das 05:00 às 20:00 pelo "Até" e ela ocupa a coluna até as 20:00', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Nova tarefa' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nova tarefa' });
  await dialog.getByLabel('Título', { exact: true }).fill('Plantão');
  await dialog.getByLabel('Dia', { exact: true }).selectOption('0');
  await dialog.getByLabel('Horário', { exact: true }).selectOption('0');
  await dialog.getByLabel('Até', { exact: true }).selectOption({ label: '20:00 (15 h)' });
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(dialog).toBeHidden();

  const card = taskCard(boardCell(page, 0, 0), 'Plantão');
  await expect(card).toBeVisible();
  // O cartão desce sobre as 30 linhas; as cobertas ficam vazias.
  const row = await boardCell(page, 0, 0).boundingBox();
  const box = await card.boundingBox();
  expect(row && box).toBeTruthy();
  expect(Math.abs((box?.height ?? 0) - (30 * (row?.height ?? 0) - 6))).toBeLessThanOrEqual(2);
  await expect(boardCell(page, 0, 29)).toHaveClass(/is-covered/);
  await expect(boardCell(page, 0, 29)).toBeEmpty();
  await expect(boardCell(page, 0, 30)).not.toHaveClass(/is-covered/);

  expect(await byTitle(request, 'Plantão')).toMatchObject({ day: 0, slot: 0, span: 30 });
});

test('arrastar um bloco sobre outro do mesmo tamanho troca os dois; de tamanho diferente avisa e nada muda', async ({
  page,
  request,
  consoleErrors,
}) => {
  consoleErrors.allow(httpStatusConsoleError(409));
  await createSpanTask(request, 'Estudo', 0, 0, 2);
  await createSpanTask(request, 'Curso', 1, 4, 2);
  await createSpanTask(request, 'Café', 2, 0, 1);
  await page.goto('/');
  await expect(taskCard(boardCell(page, 1, 4), 'Curso')).toBeVisible();

  // Solta no segundo slot do Curso: troca exata, o Estudo assume o início dele.
  await dragTo(page, taskCard(boardCell(page, 0, 0), 'Estudo'), boardCell(page, 1, 5));
  await expect(taskCard(boardCell(page, 1, 4), 'Estudo')).toBeVisible();
  await expect(taskCard(boardCell(page, 0, 0), 'Curso')).toBeVisible();

  // Sobre uma tarefa de outro tamanho: aviso, e as posições continuam.
  await dragTo(page, taskCard(boardCell(page, 1, 4), 'Estudo'), boardCell(page, 2, 0));
  await expect(notice(page)).toContainText('Esse horário já está ocupado');
  await expect(taskCard(boardCell(page, 1, 4), 'Estudo')).toBeVisible();
  expect(await byTitle(request, 'Estudo')).toMatchObject({ day: 1, slot: 4, span: 2 });
  expect(await byTitle(request, 'Café')).toMatchObject({ day: 2, slot: 0, span: 1 });
});

test('puxar a borda de baixo muda a duração de 30 em 30 min e para na tarefa de baixo', async ({ page, request }) => {
  await createSpanTask(request, 'Leitura', 3, 0, 1);
  await createSpanTask(request, 'Almoço', 3, 3, 1);
  await page.goto('/');

  const card = taskCard(boardCell(page, 3, 0), 'Leitura');
  await card.hover();
  const handle = card.locator('.task-card__resize');
  const grip = await handle.boundingBox();
  const row = await boardCell(page, 3, 0).boundingBox();
  if (!grip || !row) throw new Error('Borda ou célula sem caixa visível');

  // Puxa 6 linhas para baixo: passa do Almoço, mas a duração para em 3 (até as 06:30).
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 6 * row.height, { steps: 12 });
  await page.mouse.up();

  await expect.poll(() => card.evaluate((element) => (element as HTMLElement).style.getPropertyValue('--span'))).toBe('3');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async () => (await byTitle(request, 'Leitura'))?.span).toBe(3);
  expect(await byTitle(request, 'Almoço')).toMatchObject({ day: 3, slot: 3, span: 1 });
});
