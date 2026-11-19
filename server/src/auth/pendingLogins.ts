import { randomBytes } from 'node:crypto';
import type { Now } from '../clock';
import type { LoginChecks } from './identity';

/** Tempo para a pessoa voltar do Google. */
export const PENDING_LOGIN_TTL_MS = 10 * 60 * 1000;
/** Teto de logins em andamento. Com o mapa cheio, logins novos são recusados (não se expulsa ninguém). */
export const PENDING_LOGIN_MAX = 10_000;

/** Formato do id que vai no cookie `quadro_oauth`: 32 bytes em base64url. */
const PENDING_ID = /^[A-Za-z0-9_-]{43}$/;

/** O que fica no servidor entre o início do login e a volta do provedor. */
export interface PendingLogin {
  readonly checks: LoginChecks;
  /** Caminho de volta no app, já saneado (`sanitizeNext`). */
  readonly next: string;
}

export interface PendingLogins {
  /** Guarda o login e devolve o id do cookie, ou null quando o mapa está cheio. */
  put(login: PendingLogin): string | null;
  /** Devolve e apaga a entrada (sempre, mesmo que a troca falhe depois). Null se não existe ou expirou. */
  take(id: string): PendingLogin | null;
  /** Entradas válidas agora (para teste e diagnóstico). */
  size(): number;
}

export interface PendingLoginsOptions {
  ttlMs?: number;
  max?: number;
}

/**
 * `state`, `nonce` e `code_verifier` ficam só aqui, na memória do processo; o
 * navegador guarda só um id aleatório. Reiniciar o servidor invalida os logins
 * em andamento (por isso o `dev:e2e` roda sem watch).
 */
export function createPendingLogins(now: Now, options: PendingLoginsOptions = {}): PendingLogins {
  const ttlMs = options.ttlMs ?? PENDING_LOGIN_TTL_MS;
  const max = options.max ?? PENDING_LOGIN_MAX;
  const entries = new Map<string, { login: PendingLogin; expiresAt: number }>();

  // O TTL é fixo, então a ordem de inserção do Map já é a ordem de expiração.
  function prune(at: number): void {
    for (const [id, entry] of entries) {
      if (entry.expiresAt > at) break;
      entries.delete(id);
    }
  }

  return {
    put(login) {
      const at = now().getTime();
      prune(at);
      if (entries.size >= max) return null;
      const id = randomBytes(32).toString('base64url');
      entries.set(id, { login, expiresAt: at + ttlMs });
      return id;
    },
    take(id) {
      if (!PENDING_ID.test(id)) return null;
      const entry = entries.get(id);
      if (!entry) return null;
      entries.delete(id);
      return entry.expiresAt > now().getTime() ? entry.login : null;
    },
    size() {
      prune(now().getTime());
      return entries.size;
    },
  };
}
