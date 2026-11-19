import {
  boardCell,
  boardRegion,
  createTask,
  deckRegion,
  dragTo,
  expect,
  listTasks,
  notice,
  taskCard,
  test,
} from './fixtures';

// @producao: também roda contra o build servido pelo Fastify, com a CSP estrita do HTML.
test('cria uma tarefa com cor e checklist, e ela continua igual depois de recarregar', { tag: '@producao' }, async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Nova tarefa' }).click();

  const dialog = page.getByRole('dialog', { name: 'Nova tarefa' });
  await dialog.getByLabel('Título', { exact: true }).fill('Comprar pão');
  await dialog.getByRole('radio', { name: 'Azul' }).check();
  const editor = dialog.getByRole('textbox', { name: 'Detalhes' });
  await editor.click();
  await dialog.getByRole('button', { name: 'Lista de tarefas (checkbox)' }).click();
  // O botão não tira o foco do editor; se tirasse, o começo do texto se perderia.
  await expect(editor).toBeFocused();
  await page.keyboard.type('Pão integral');
  // O texto entrou no item do checklist (o nome do checkbox vem do texto do item), não num parágrafo depois da lista.
  const item = dialog.getByRole('checkbox', { name: 'Pendente: Pão integral' });
  await expect(item).toBeVisible();
  await item.check();
  await dialog.getByRole('button', { name: 'Salvar' }).click();

  await expect(dialog).toBeHidden();
  await expect(notice(page)).toHaveText(/Tarefa criada/);
  await expect(taskCard(deckRegion(page), 'Comprar pão')).toHaveAccessibleName(/Checklist: 1 de 1 concluídos/);

  await page.reload();
  await taskCard(deckRegion(page), 'Comprar pão').click();
  const edit = page.getByRole('dialog', { name: 'Editar tarefa' });
  await expect(edit.getByLabel('Título', { exact: true })).toHaveValue('Comprar pão');
  await expect(edit.getByRole('radio', { name: 'Azul' })).toBeChecked();
  // Um item só, marcado e com o texto. O editor também contém o rótulo escondido do checkbox,
  // por isso a conferência é pelo nome do checkbox, e não pelo texto do editor inteiro.
  await expect(edit.getByRole('checkbox')).toHaveCount(1);
  await expect(edit.getByRole('checkbox', { name: 'Concluído: Pão integral' })).toBeChecked();
  await edit.getByRole('button', { name: 'Cancelar' }).click();
  await expect(edit).toBeHidden();
});

test(
  'arrasta do deck para o quadro, entre células, troca ao soltar numa ocupada e volta para o deck',
  { tag: '@producao' },
  async ({ page, request }) => {
    await createTask(request, { title: 'Academia' });
    await createTask(request, { title: 'Reunião', position: { kind: 'cell', day: 0, slot: 1 } });
    await page.goto('/');
    await expect(taskCard(boardCell(page, 0, 1), 'Reunião')).toBeVisible();

    // Deck → célula livre (segunda 05:00).
    await dragTo(page, taskCard(deckRegion(page), 'Academia'), boardCell(page, 0, 0));
    await expect(taskCard(boardCell(page, 0, 0), 'Academia')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tarefas (0)' })).toBeVisible();

    // Célula → célula ocupada: as duas trocam.
    await dragTo(page, taskCard(boardCell(page, 0, 0), 'Academia'), boardCell(page, 0, 1));
    await expect(taskCard(boardCell(page, 0, 1), 'Academia')).toBeVisible();
    await expect(taskCard(boardCell(page, 0, 0), 'Reunião')).toBeVisible();

    // Célula → célula livre em outro dia (terça 06:00).
    await dragTo(page, taskCard(boardCell(page, 0, 1), 'Academia'), boardCell(page, 1, 2));
    await expect(taskCard(boardCell(page, 1, 2), 'Academia')).toBeVisible();
    await expect(boardCell(page, 0, 1)).toBeEmpty();

    // Célula → deck.
    await dragTo(page, taskCard(boardCell(page, 0, 0), 'Reunião'), deckRegion(page));
    await expect(taskCard(deckRegion(page), 'Reunião')).toBeVisible();
    await expect(boardCell(page, 0, 0)).toBeEmpty();

    const tasks = await listTasks(request);
    expect(tasks.find((t) => t.title === 'Academia')).toMatchObject({ day: 1, slot: 2 });
    expect(tasks.find((t) => t.title === 'Reunião')).toMatchObject({ day: null, slot: null });
  },
);

test('o campo Quando mostra o horário ocupado desabilitado e agenda num horário livre', async ({ page, request }) => {
  await createTask(request, { title: 'Dentista', position: { kind: 'cell', day: 0, slot: 2 } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Nova tarefa' }).click();

  const dialog = page.getByRole('dialog', { name: 'Nova tarefa' });
  await dialog.getByLabel('Título', { exact: true }).fill('Mercado');
  await dialog.getByLabel('Dia', { exact: true }).selectOption('0');
  const slotSelect = dialog.getByLabel('Horário', { exact: true });
  await expect(slotSelect.locator('option', { hasText: '06:00 – 06:30 · ocupado (Dentista)' })).toBeDisabled();
  await slotSelect.selectOption('3');
  await dialog.getByRole('button', { name: 'Salvar' }).click();

  await expect(dialog).toBeHidden();
  await expect(taskCard(boardCell(page, 0, 3), 'Mercado')).toBeVisible();
  await expect(taskCard(boardCell(page, 0, 2), 'Dentista')).toBeVisible();
});

test('Resetar quadro devolve todas as tarefas ao deck sem apagar nenhuma', async ({ page, request }) => {
  await createTask(request, { title: 'Academia', position: { kind: 'cell', day: 0, slot: 0 } });
  await createTask(request, { title: 'Relatório', position: { kind: 'cell', day: 2, slot: 4 } });
  await page.goto('/');
  await expect(taskCard(boardCell(page, 2, 4), 'Relatório')).toBeVisible();

  await page.getByRole('button', { name: 'Resetar quadro' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Resetar o quadro?' });
  await confirm.getByRole('button', { name: 'Resetar' }).click();

  await expect(notice(page)).toHaveText(/2 tarefas voltaram para o deck\./);
  await expect(page.getByRole('heading', { name: 'Tarefas (2)' })).toBeVisible();
  await expect(boardRegion(page).getByRole('button', { name: /Academia|Relatório/ })).toHaveCount(0);
  const tasks = await listTasks(request);
  expect(tasks).toHaveLength(2);
  expect(tasks.every((t) => t.day === null && t.slot === null)).toBe(true);
});

test('a bolinha de feriado no cabeçalho do dia abre o modal com o feriado', async ({ page }) => {
  // A data simulada é fixa, mas a rota da agenda só aceita semanas a até 1 ano da data do servidor.
  // A agenda não é o assunto deste teste, então a resposta dela é fixada aqui.
  await page.route('**/api/calendar/events**', (route) => route.fulfill({ json: { enabled: false, events: [] } }));
  await page.goto('/?hoje=2026-11-15');

  await boardRegion(page)
    .getByRole('button', { name: 'Feriado: Dia Nacional de Zumbi e da Consciência Negra (20/11)' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Feriados' });
  await expect(dialog).toContainText('Dia Nacional de Zumbi e da Consciência Negra');
  await expect(dialog).toContainText('Feriado · sexta-feira, 20/11');
  await dialog.getByRole('button', { name: 'Fechar' }).click();
  await expect(dialog).toBeHidden();
});

test('com a agenda desligada não aparece bolinha roxa nem erro no topo', async ({ page }) => {
  const calendar = page.waitForResponse((response) => response.url().includes('/api/calendar/events'));
  await page.goto('/');
  const response = await calendar;
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ enabled: false, events: [] });

  await expect(boardRegion(page)).toBeVisible();
  await expect(page.locator('.calendar-dot')).toHaveCount(0);
  await expect(page.locator('.calendar-header__agenda')).toHaveCount(0);
});
