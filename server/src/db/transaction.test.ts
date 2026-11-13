import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTempDb, type TempDb } from '../../test/helpers/tempDb';
import { withTransaction } from './transaction';

let temp: TempDb;
beforeEach(() => {
  temp = createTempDb({ migrate: false });
  temp.db.exec('CREATE TABLE t (v INTEGER NOT NULL)');
});
afterEach(() => temp.cleanup());

const count = () => (temp.db.prepare('SELECT COUNT(*) AS n FROM t').get() as { n: number }).n;

describe('withTransaction', () => {
  it('faz commit e devolve o resultado', () => {
    const result = withTransaction(temp.db, () => {
      temp.db.prepare('INSERT INTO t (v) VALUES (1)').run();
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(count()).toBe(1);
    expect(temp.db.isTransaction).toBe(false);
  });

  it('faz rollback e relança o erro', () => {
    expect(() =>
      withTransaction(temp.db, () => {
        temp.db.prepare('INSERT INTO t (v) VALUES (1)').run();
        throw new Error('falhou');
      }),
    ).toThrow('falhou');
    expect(count()).toBe(0);
    expect(temp.db.isTransaction).toBe(false);
  });

  it('desfaz também quando o erro vem do SQLite', () => {
    expect(() =>
      withTransaction(temp.db, () => {
        temp.db.prepare('INSERT INTO t (v) VALUES (1)').run();
        temp.db.prepare('INSERT INTO t (v) VALUES (NULL)').run();
      }),
    ).toThrow();
    expect(count()).toBe(0);
  });
});
