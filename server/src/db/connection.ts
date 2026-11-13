import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Database = DatabaseSync;

/** Abre (e cria, se preciso) o arquivo SQLite com os pragmas do projeto. */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 3000');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

export function sqliteVersion(db: DatabaseSync): string {
  const row = db.prepare('SELECT sqlite_version() AS version').get() as { version: string };
  return row.version;
}
