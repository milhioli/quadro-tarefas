import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTempDb, type TempDb } from '../../test/helpers/tempDb';
import { openDatabase, sqliteVersion } from './connection';

let temp: TempDb | undefined;
afterEach(() => {
  temp?.cleanup();
  temp = undefined;
});

describe('openDatabase', () => {
  it('abre o SQLite embutido do Node sob o Vitest', () => {
    temp = createTempDb({ migrate: false });
    expect(sqliteVersion(temp.db)).toMatch(/^3\.\d+\.\d+$/);
  });

  it('aplica WAL, busy_timeout, foreign_keys e secure_delete', () => {
    temp = createTempDb({ migrate: false });
    const pragma = (name: string) => Object.values(temp!.db.prepare(`PRAGMA ${name}`).get() as object)[0];
    expect(pragma('journal_mode')).toBe('wal');
    expect(pragma('busy_timeout')).toBe(5000);
    expect(pragma('foreign_keys')).toBe(1);
    expect(pragma('secure_delete')).toBe(1);
  });

  it('cria a pasta do arquivo quando não existe', () => {
    temp = createTempDb({ migrate: false });
    const nested = join(temp.dir, 'a', 'b', 'q.sqlite');
    const db = openDatabase(nested);
    try {
      expect(existsSync(nested)).toBe(true);
    } finally {
      db.close();
    }
  });

  it('aceita :memory:', () => {
    const db = openDatabase(':memory:');
    expect(sqliteVersion(db)).toMatch(/^3\./);
    db.close();
  });
});
