import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import type { NameSuggestions } from './auth/nameSuggestions';
import type { Now } from './clock';
import { withTransaction } from './db/transaction';
import { auditDeletedAccount, type AccountRepository } from './repositories/accountRepository';
import type { AuditRepository } from './repositories/auditRepository';
import { INVITE_BLOCK_MS } from './repositories/boardRepository';

/**
 * Retenção (Fase 2b, docs/fase-2b.md; a tabela vai para a /privacidade).
 * Um job diário no próprio processo, sem cron externo, com o relógio do clock.ts.
 */
const DAY = 24 * 60 * 60 * 1000;

export const RETENTION = Object.freeze({
  /** A linha de auditoria é apagada (anonimizar não basta: o id do quadro reidentifica quem agiu). */
  auditMs: 180 * DAY,
  inviteBlockMs: INVITE_BLOCK_MS,
  /** Convite sem resposta. */
  pendingInviteMs: 30 * DAY,
  /** Entrou com o Google e nunca criou o perfil. */
  pendingAccountMs: 7 * DAY,
  /** Desativada pelo admin (conta a partir do `disabled_at`). */
  disabledAccountMs: 365 * DAY,
  /** Sem nenhum acesso. O admin nunca é apagado por isso. */
  inactiveAccountMs: 730 * DAY,
});

export const RETENTION_INTERVAL_MS = DAY;

export interface RetentionResult {
  sessions: number;
  audit: number;
  inviteBlocks: number;
  invites: number;
  pendingAccounts: number;
  disabledAccounts: number;
  inactiveAccounts: number;
}

export interface RetentionDeps {
  accounts: AccountRepository;
  audit: AuditRepository;
  /** Chamado a cada conta apagada (ex.: tirar a sugestão de nome da memória). */
  onAccountDeleted?: (userId: number) => void;
}

export function runRetention(db: DatabaseSync, now: Now, deps: RetentionDeps): RetentionResult {
  const at = now().getTime();
  const iso = (ms: number) => new Date(at - ms).toISOString();
  const nowIso = new Date(at).toISOString();
  const changes = (sql: string, ...params: string[]) => Number(db.prepare(sql).run(...params).changes);

  const simple = withTransaction(db, () => ({
    // expires_at nunca passa de created_at + 90 dias: isto cobre os dois prazos.
    sessions: changes('DELETE FROM sessions WHERE expires_at <= ?', nowIso),
    audit: changes('DELETE FROM audit_log WHERE at < ?', iso(RETENTION.auditMs)),
    inviteBlocks: changes('DELETE FROM invite_blocks WHERE created_at < ?', iso(RETENTION.inviteBlockMs)),
    invites: changes("DELETE FROM board_members WHERE status = 'invited' AND created_at < ?", iso(RETENTION.pendingInviteMs)),
  }));

  // Cada conta numa transação própria (deleteAccount abre a dela).
  const deleteAll = (sql: string, cutoff: string): number => {
    const ids = (db.prepare(sql).all(cutoff) as Array<{ id: number }>).map((row) => row.id);
    let deleted = 0;
    for (const id of ids) {
      const result = deps.accounts.deleteAccount(id);
      if (!result) continue;
      auditDeletedAccount(deps.audit, null, result);
      deps.onAccountDeleted?.(id);
      deleted += 1;
    }
    return deleted;
  };

  return {
    ...simple,
    pendingAccounts: deleteAll(
      "SELECT id FROM users WHERE username IS NULL AND role <> 'admin' AND last_seen_at < ?",
      iso(RETENTION.pendingAccountMs),
    ),
    disabledAccounts: deleteAll(
      "SELECT id FROM users WHERE status = 'disabled' AND role <> 'admin' AND disabled_at IS NOT NULL AND disabled_at < ?",
      iso(RETENTION.disabledAccountMs),
    ),
    inactiveAccounts: deleteAll(
      "SELECT id FROM users WHERE status = 'active' AND role <> 'admin' AND username IS NOT NULL AND last_seen_at < ?",
      iso(RETENTION.inactiveAccountMs),
    ),
  };
}

export interface RegisterRetentionOptions extends RetentionDeps {
  db: DatabaseSync;
  now: Now;
  suggestions: NameSuggestions;
  intervalMs?: number;
}

/**
 * Roda a retenção quando o app fica pronto e depois a cada 24 h. O timer não
 * segura o processo (unref) e para no close. O log leva só as contagens.
 */
export function registerRetention(app: FastifyInstance, options: RegisterRetentionOptions): void {
  let timer: ReturnType<typeof setInterval> | undefined;
  const run = () => {
    try {
      const result = runRetention(options.db, options.now, {
        accounts: options.accounts,
        audit: options.audit,
        onAccountDeleted: (id) => {
          options.suggestions.delete(id);
          options.onAccountDeleted?.(id);
        },
      });
      app.log.info({ kind: 'retention', status: 'ok', ...result }, 'Retenção aplicada');
    } catch {
      // Nunca o erro cru (pode levar caminho do banco ou SQL).
      app.log.error({ kind: 'retention', status: 'error' }, 'A retenção falhou');
    }
  };
  app.addHook('onReady', async () => {
    run();
    timer = setInterval(run, options.intervalMs ?? RETENTION_INTERVAL_MS);
    timer.unref();
  });
  app.addHook('onClose', async () => {
    if (timer) clearInterval(timer);
  });
}
