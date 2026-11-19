import { expect, test } from './fixtures';

// Projeto `producao` (Fase 2b): o build do web servido pelo próprio Fastify, como no deploy.
// É o único lugar em que a CSP estrita do HTML vale; um <style> inline ou um script de fora
// apareceria como erro no console, e a fixture reprova o teste.

const HTML_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; " +
  "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

test.describe('build servido pelo Fastify', { tag: '@producao' }, () => {
  test('o HTML vem com a CSP estrita e sem cache; os assets com hash ficam em cache', async ({ request }) => {
    const index = await request.get('/');
    expect(index.status()).toBe(200);
    expect(index.headers()['content-type']).toContain('text/html');
    expect(index.headers()['content-security-policy']).toBe(HTML_CSP);
    expect(index.headers()['cache-control']).toBe('no-store');

    const script = /src="(\/assets\/[^"]+\.js)"/.exec(await index.text())?.[1];
    expect(script, 'o index.html aponta para um script em /assets').toBeDefined();
    const asset = await request.get(script as string);
    expect(asset.status()).toBe(200);
    expect(asset.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(asset.headers()['content-type']).toContain('javascript');
  });

  test('só existem /, /privacidade e /assets: o resto (inclusive .env e index.html) dá 404', async ({ request }) => {
    expect((await request.get('/privacidade')).status()).toBe(200);
    for (const url of ['/.env', '/nao-existe', '/index.html', '/assets/nao-existe.js', '/assets/..%2F.env']) {
      expect((await request.get(url)).status(), url).toBe(404);
    }
  });

  test('com o editor aberto, nenhum <style> na página, e o editor tem as regras base do ProseMirror', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nova tarefa' }).click();
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();
    await expect(page.locator('style')).toHaveCount(0);
    expect(await editor.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe('break-spaces');
  });
});
