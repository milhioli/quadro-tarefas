import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * E2E no navegador real. Regras:
 * - o servidor sobe com `npm run dev`, NUNCA `dev:agenda` (agentes nunca ligam a agenda);
 * - portas próprias, para não colidir com o `npm run dev` de quem está usando;
 * - banco novo numa pasta temporária a cada execução (nunca o server/data/quadro.sqlite).
 */
const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
export const API_PORT = 3101;
export const WEB_PORT = 5273;
export const BASE_URL = `http://127.0.0.1:${WEB_PORT}`;

// Os workers reavaliam este arquivo: a variável herdada mantém a mesma pasta da execução.
const runDir = (process.env.QUADRO_E2E_DIR ??= mkdtempSync(join(tmpdir(), 'quadro-e2e-')));

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
      testIgnore: '**/mobile.spec.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      testMatch: '**/mobile.spec.ts',
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
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
    },
  },
});
