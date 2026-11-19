import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTempDb, type TempDb } from '../../test/helpers/tempDb';
import { fixedNow } from '../clock';
import { createAuditRepository } from './auditRepository';

let temp: TempDb;
beforeEach(() => {
  temp = createTempDb();
});
afterEach(() => temp.cleanup());

describe('auditRepository', () => {
  it('grava ação, ator e alvo com a hora do relógio injetado', () => {
    const audit = createAuditRepository(temp.db, fixedNow('2026-11-18T12:00:00.000Z'));
    audit.record(null, 'login');
    audit.record(null, 'board.create', { kind: 'board', id: 1 });
    expect(temp.db.prepare('SELECT at, actor_user_id, action, target_kind, target_id FROM audit_log ORDER BY id').all()).toEqual([
      { at: '2026-11-18T12:00:00.000Z', actor_user_id: null, action: 'login', target_kind: null, target_id: null },
      { at: '2026-11-18T12:00:00.000Z', actor_user_id: null, action: 'board.create', target_kind: 'board', target_id: 1 },
    ]);
  });

  it('a tabela não tem coluna para e-mail, handle nem texto livre', () => {
    const columns = (temp.db.prepare('PRAGMA table_info(audit_log)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(columns).toEqual(['id', 'at', 'actor_user_id', 'action', 'target_kind', 'target_id']);
  });
});
