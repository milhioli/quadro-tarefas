import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/db/connection';
import { migrate } from '../../src/db/migrations';

export interface TempDb {
  dir: string;
  path: string;
  db: DatabaseSync;
  /** Abre outra conexão no mesmo arquivo (simula reiniciar o servidor). */
  reopen(): DatabaseSync;
  cleanup(): void;
}

/** SQLite real num diretório temporário, já migrado. Nunca é mock. */
export function createTempDb(options: { migrate?: boolean } = {}): TempDb {
  const dir = mkdtempSync(join(tmpdir(), 'quadro-test-'));
  const path = join(dir, 'quadro.sqlite');
  const opened: DatabaseSync[] = [];

  const open = (): DatabaseSync => {
    const db = openDatabase(path);
    if (options.migrate ?? true) migrate(db);
    opened.push(db);
    return db;
  };

  const db = open();
  return {
    dir,
    path,
    db,
    reopen: open,
    cleanup() {
      // No Windows os arquivos -wal/-shm ficam travados enquanto a conexão estiver aberta.
      for (const conn of opened) if (conn.isOpen) conn.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    },
  };
}
