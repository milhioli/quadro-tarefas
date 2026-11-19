import { expect, test } from './fixtures';

// Fase 2b: a página de privacidade abre sem login, no dev (Vite) e no build (projeto producao).

test.describe('página de privacidade', { tag: '@producao' }, () => {
  test.use({ loggedIn: false });

  test('abre sem login e mostra o responsável e o contato', async ({ page }) => {
    await page.goto('/privacidade');
    await expect(page.getByRole('heading', { level: 1, name: 'Privacidade' })).toBeVisible();
    await expect(page.getByText(/operado por Operador E2E/)).toBeVisible();
    const contact = page.getByRole('link', { name: 'contato@example.com' }).first();
    await expect(contact).toHaveAttribute('href', 'mailto:contato@example.com');
    await expect(page.getByRole('table', { name: 'Prazos de guarda' })).toBeVisible();
  });

  test('o rodapé da tela de entrada leva à página, e ela tem o caminho de volta', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Privacidade' }).click();
    await expect(page).toHaveURL(/\/privacidade$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Privacidade' })).toBeVisible();
    await page.getByRole('link', { name: 'Voltar ao Quadro de tarefas' }).click();
    await expect(page.getByRole('button', { name: 'Entrar (teste)' })).toBeVisible();
  });
});
