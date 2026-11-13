import type { DatabaseSync } from 'node:sqlite';

/**
 * Executa `fn` numa transação BEGIN IMMEDIATE (trava de escrita desde o início).
 * Faz commit se `fn` retornar e rollback se lançar erro.
 */
export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
