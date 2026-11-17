import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type UserConfig } from 'vite';

/** O frontend só escuta na interface de loopback. Não é configurável de propósito. */
export const WEB_HOST = '127.0.0.1';
export const DEFAULT_WEB_PORT = 5173;
export const DEFAULT_API_PORT = 3001;

/** Raiz do repositório, onde fica o .env opcional (o mesmo que a API lê). */
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

type Env = Readonly<Record<string, string | undefined>>;

export function parsePort(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = raw.trim();
  if (!/^\d{1,5}$/.test(value)) throw new Error(`${name} inválida: use um número de porta`);
  const port = Number(value);
  if (port < 1024 || port > 65535) throw new Error(`${name} inválida: use uma porta entre 1024 e 65535`);
  return port;
}

/**
 * Headers de segurança do servidor de desenvolvimento.
 * `default-src`/`script-src` ficam de fora enquanto o app roda só em dev:
 * o preâmbulo inline do React Refresh quebraria com eles.
 */
export function securityHeaders(webPort: number): Record<string, string> {
  return {
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': [
      "frame-ancestors 'none'",
      `connect-src 'self' ws://127.0.0.1:${webPort} ws://localhost:${webPort}`,
      "img-src 'self' data:",
      "object-src 'none'",
      "base-uri 'self'",
    ].join('; '),
  };
}

export function buildViteConfig(env: Env): UserConfig {
  const webPort = parsePort(env.WEB_PORT, DEFAULT_WEB_PORT, 'WEB_PORT');
  const apiPort = parsePort(env.API_PORT, DEFAULT_API_PORT, 'API_PORT');

  return {
    plugins: [react()],
    server: {
      host: WEB_HOST,
      port: webPort,
      strictPort: true,
      // O padrão do Vite aceita qualquer origem localhost e responderia o preflight antes do proxy.
      cors: false,
      headers: securityHeaders(webPort),
      proxy: {
        // changeOrigin: false preserva o Host original, que o guard da API confere.
        '/api': { target: `http://${WEB_HOST}:${apiPort}`, changeOrigin: false },
      },
    },
    build: {
      sourcemap: false,
    },
  };
}

/** Só as chaves que o Vite usa: o processo do Vite nunca carrega a senha da agenda. */
export const VITE_ENV_KEYS = ['WEB_PORT', 'API_PORT'] as const;

export default defineConfig(({ mode }) => buildViteConfig(loadEnv(mode, REPO_ROOT, [...VITE_ENV_KEYS])));
