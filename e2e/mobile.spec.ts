import { createTask, expect, slotLabel, test } from './fixtures';

// Roda no projeto "mobile" (Pixel 7, ≤ 768 px): o quadro com arraste dá lugar à agenda por toque.

test('as três tags trocam a visualização e a escolha continua depois de recarregar', async ({ page, request }) => {
  await createTask(request, { title: 'Academia', position: { kind: 'cell', day: 0, slot: 4 } });
  await page.goto('/');

  const views = page.getByRole('group', { name: 'Visualização' });
  await expect(views.getByRole('button', { name: 'Dia', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('tab', { name: /^Seg/ }).click();

  // Dia: só o que está agendado.
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByRole('button', { name: `${slotLabel(4)} Academia` })).toBeVisible();
  await expect(panel.getByRole('button', { name: /^Agendar em / })).toHaveCount(0);

  // Dia completo: as 34 faixas, 33 livres.
  await views.getByRole('button', { name: 'Dia completo' }).click();
  await expect(views.getByRole('button', { name: 'Dia completo' })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByRole('button', { name: /^Agendar em / })).toHaveCount(33);
  await expect(panel.getByRole('button', { name: `${slotLabel(4)} Academia` })).toBeVisible();

  // Semana: os cinco dias em lista.
  await views.getByRole('button', { name: 'Semana' }).click();
  await expect(page.getByRole('heading', { name: /^Seg / })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Sex / })).toBeVisible();
  await expect(page.getByRole('button', { name: `${slotLabel(4)} Academia` })).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole('group', { name: 'Visualização' }).getByRole('button', { name: 'Semana' }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('tarefa com duração vira uma linha "05:00 – 20:00" e as faixas cobertas somem do Dia completo', async ({
  page,
  request,
}) => {
  const response = await request.post('/api/tasks', {
    headers: { 'X-Quadro-Client': '1' },
    data: { title: 'Plantão', span: 30, position: { kind: 'cell', day: 0, slot: 0 } },
  });
  expect(response.status()).toBe(201);

  await page.goto('/');
  await page.getByRole('group', { name: 'Visualização' }).getByRole('button', { name: 'Dia completo' }).click();
  await page.getByRole('tab', { name: /^Seg/ }).click();
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByRole('button', { name: '05:00 – 20:00 Plantão' })).toBeVisible();
  await expect(panel.getByRole('button', { name: /^Agendar em / })).toHaveCount(4);

  await page.getByRole('group', { name: 'Visualização' }).getByRole('button', { name: 'Dia', exact: true }).click();
  await expect(panel.getByRole('button', { name: '05:00 – 20:00 Plantão' })).toBeVisible();
});

test('"+ livre" abre Nova tarefa já com o dia e o horário', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('group', { name: 'Visualização' }).getByRole('button', { name: 'Dia completo' }).click();
  await page.getByRole('tab', { name: /^Seg/ }).click();

  const nine = slotLabel(8);
  await page.getByRole('button', { name: new RegExp(`^Agendar em Segunda \\d{2}/\\d{2}, ${nine}$`) }).click();
  const dialog = page.getByRole('dialog', { name: 'Nova tarefa' });
  await expect(dialog.getByLabel('Dia', { exact: true })).toHaveValue('0');
  await expect(dialog.getByLabel('Horário', { exact: true })).toHaveValue('8');

  await dialog.getByLabel('Título', { exact: true }).fill('Estudar');
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('tabpanel').getByRole('button', { name: `${nine} Estudar` })).toBeVisible();
});
