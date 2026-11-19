import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { API_PORT, BASE_URL, PROD_PORT, PROD_URL, WEB_PORT } from './ports';

/**
 * E2E no navegador real. Regras:
 * - o servidor sobe com `npm run dev:e2e` (server/src/e2eEntry.ts: login de teste só com
 *   e-mails @example.com, sem Google e sem agenda), NUNCA `dev:agenda` (agentes nunca ligam a agenda);
 * - cada teste entra com uma conta nova (fixture `account`), então o quadro pessoal começa vazio;
 * - portas próprias, para não colidir com o `npm run dev` de quem está usando;
 * - banco novo numa pasta temporária a cada execução (nunca o server/data/quadro.sqlite);
 * - o projeto `producao` roda as jornadas marcadas com @producao contra o build do web
 *   servido pelo próprio Fastify (`npm run dev:e2e:static`), o único com a CSP estrita do HTML.
 */
const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

// Os workers reavaliam este arquivo: a variável herdada mantém a mesma pasta da execução.
const runDir = (process.env.QUADRO_E2E_DIR ??= mkdtempSync(join(tmpdir(), 'quadro-e2e-')));

/** O mesmo nos dois servidores: e-mails só de teste (o e2eEntry ignora qualquer outro). */
const COMMON_ENV = {
  // Só vira admin quem entrar com este e-mail de teste (as jornadas de admin usam).
  QUADRO_ADMIN_EMAIL: 'admin@example.com',
  QUADRO_CONTACT_EMAIL: 'contato@example.com',
  QUADRO_OPERATOR_NAME: 'Operador E2E',
};

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: ['**/mobile.spec.ts', '**/producao.spec.ts'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      testMatch: '**/mobile.spec.ts',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'producao',
      grep: /@producao/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, baseURL: PROD_URL },
    },
  ],
  webServer: [
    {
      command: 'npm run dev:e2e',
      cwd: REPO_ROOT,
      // Passa pelo proxy do Vite até a API: só responde quando os dois estão no ar.
      url: `${BASE_URL}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        API_PORT: String(API_PORT),
        WEB_PORT: String(WEB_PORT),
        DB_PATH: join(runDir, 'quadro-e2e.sqlite'),
        APP_ORIGIN: BASE_URL,
        ...COMMON_ENV,
      },
    },
    {
      // Build do web + e2eEntry --static: web e API na mesma porta, como no deploy.
      command: 'npm run dev:e2e:static',
      cwd: REPO_ROOT,
      url: `${PROD_URL}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        API_PORT: String(PROD_PORT),
        WEB_PORT: String(PROD_PORT),
        DB_PATH: join(runDir, 'quadro-e2e-producao.sqlite'),
        APP_ORIGIN: PROD_URL,
        ...COMMON_ENV,
      },
    },
  ],
});
