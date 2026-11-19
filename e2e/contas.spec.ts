import {
  CLIENT_HEADERS,
  accountEmail,
  boardSelect,
  createTask,
  deckRegion,
  expect,
  openAs,
  taskCard,
  test,
} from './fixtures';

// Fase 2a do docs/roteiro.md: contas, quadros e grupos. O servidor de E2E (`npm run dev:e2e`)
// troca o Google pelo login de teste (só e-mails @example.com); o resto é o fluxo real.

test.describe('sem sessão', () => {
  test.use({ loggedIn: false });

  test('entra pelo login de teste, escolhe o nome de usuário e cai no quadro pessoal vazio; Sair volta para o login', async ({
    page,
    request,
  }, testInfo) => {
    await page.goto('/');
    // Sem Google configurado no servidor de E2E: a tela explica, e o login de teste aparece.
    await expect(page.getByText(/não está configurado neste servidor/)).toBeVisible();
    await page.getByLabel('E-mail de teste').fill(accountEmail(testInfo));
    await page.getByRole('button', { name: 'Entrar (teste)' }).click();

    await page.getByLabel('Nome de usuário').fill('Nova.Pessoa');
    await page.getByLabel('Nome de exibição').fill('Nova Pessoa');
    await page.getByRole('button', { name: 'Começar' }).click();

    const handle = page.getByText(/^nova\.pessoa_\d{2,}$/);
    await expect(handle).toBeVisible();
    await expect(page.getByText('Nova Pessoa', { exact: true })).toBeVisible();
    await expect(deckRegion(page)).toHaveAccessibleName('Tarefas (0)');
    await expect(boardSelect(page).locator('option:checked')).toHaveText('Meu quadro');

    // A sessão continua depois de recarregar.
    await page.reload();
    await expect(handle).toBeVisible();

    await page.getByRole('button', { name: 'Sair' }).click();
    await expect(page.getByRole('button', { name: 'Entrar (teste)' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Entrar (teste)' })).toBeVisible();
    // Sem sessão, a API recusa (pelo request, não pela página: o 401 não passa pelo console).
    expect((await request.get('/api/boards')).status()).toBe(401);
  });
});

test('grupo: cria, convida pelo handle, a outra pessoa aceita e vê a mesma tarefa; quem sai perde o acesso', async ({
  page,
  browser,
  account,
}, testInfo) => {
  // A Bia usa outro navegador (contexto com cookies próprios).
  const bia = await openAs(browser, testInfo, 'b', { username: 'bia', displayName: 'Bia' });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Novo grupo' }).click();
    const create = page.getByRole('dialog', { name: 'Novo grupo' });
    await create.getByLabel('Nome do grupo').fill('Equipe E2E');
    await create.getByRole('button', { name: 'Criar grupo' }).click();
    await expect(create).toBeHidden();
    await expect(boardSelect(page).locator('option:checked')).toHaveText('Equipe E2E');
    const groupId = Number(await boardSelect(page).inputValue());

    // A tarefa vai para o quadro do grupo, não para o pessoal.
    await createTask(page.request, { title: 'Tarefa do grupo' }, groupId);
    await page.reload();
    await expect(taskCard(deckRegion(page), 'Tarefa do grupo')).toBeVisible();

    await page.getByRole('button', { name: 'Pessoas do grupo' }).click();
    const group = page.getByRole('dialog', { name: 'Grupo: Equipe E2E' });
    await group.getByLabel('Convidar pelo nome de usuário').fill(bia.account.handle);
    await group.getByRole('button', { name: 'Convidar' }).click();
    await expect(group.getByText(`Convite enviado para ${bia.account.handle}.`)).toBeVisible();
    await expect(group.getByText('Convite pendente')).toBeVisible();
    await group.getByRole('button', { name: 'Fechar' }).last().click();

    // Antes de aceitar, a Bia não vê o quadro (404, igual a "não existe").
    expect((await bia.context.request.get(`/api/boards/${groupId}/tasks`)).status()).toBe(404);

    await bia.page.goto('/');
    await bia.page.getByRole('button', { name: 'Convites (1)' }).click();
    const invites = bia.page.getByRole('dialog', { name: 'Convites' });
    await expect(invites.getByText(account?.handle ?? '', { exact: true })).toBeVisible();
    await invites.getByRole('button', { name: 'Aceitar o convite para Equipe E2E' }).click();
    await expect(taskCard(deckRegion(bia.page), 'Tarefa do grupo')).toBeVisible();
    await expect(boardSelect(bia.page).locator('option:checked')).toHaveText('Equipe E2E');

    // O quadro pessoal de quem criou o grupo continua só dele.
    expect((await bia.context.request.get(`/api/boards/${account?.boardId}/tasks`)).status()).toBe(404);

    await bia.page.getByRole('button', { name: 'Pessoas do grupo' }).click();
    await bia.page.getByRole('dialog', { name: 'Grupo: Equipe E2E' }).getByRole('button', { name: 'Sair do grupo' }).click();
    await bia.page.getByRole('alertdialog', { name: 'Sair do grupo?' }).getByRole('button', { name: 'Sair do grupo' }).click();
    await expect(boardSelect(bia.page).locator('option:checked')).toHaveText('Meu quadro');
    await expect(boardSelect(bia.page).locator('option', { hasText: 'Equipe E2E' })).toHaveCount(0);
    expect((await bia.context.request.get(`/api/boards/${groupId}/tasks`)).status()).toBe(404);

    expect(bia.consoleErrors, 'erros no console do navegador da Bia').toEqual([]);
  } finally {
    await bia.context.close();
  }
});

test('IDOR: a tarefa de outra pessoa não é lida nem alterada pelo id', async ({ browser, request }, testInfo) => {
  const mine = await createTask(request, { title: 'Só minha' });
  const bia = await openAs(browser, testInfo, 'b', { username: 'bia', displayName: 'Bia' });
  try {
    const read = await bia.context.request.get(`/api/tasks/${mine.id}`);
    expect(read.status()).toBe(404);
    const patch = await bia.context.request.patch(`/api/tasks/${mine.id}`, { headers: CLIENT_HEADERS, data: { title: 'Invadida' } });
    expect(patch.status()).toBe(404);
    const removal = await bia.context.request.delete(`/api/tasks/${mine.id}`, { headers: CLIENT_HEADERS });
    expect(removal.status()).toBe(404);
    expect((await request.get(`/api/tasks/${mine.id}`)).status()).toBe(200);
  } finally {
    await bia.context.close();
  }
});

test('mutação com o Origin de outro projeto local é recusada mesmo com a sessão válida', async ({ request }) => {
  // No 127.0.0.1 o cookie não separa porta: quem barra outro projeto local é o guard.
  const response = await request.post('/api/boards', {
    headers: { 'X-Quadro-Client': '1', Origin: 'http://127.0.0.1:3000' },
    data: { name: 'De outro projeto local' },
  });
  expect(response.status()).toBe(403);
  const boards = (await (await request.get('/api/boards')).json()) as { boards: Array<{ name: string }> };
  expect(boards.boards.map((board) => board.name)).toEqual(['Meu quadro']);
});
