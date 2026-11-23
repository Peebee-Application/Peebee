import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@libsql/client/node';
import { splitSqlStatements } from './split-sql.js';

test('migration splitting preserves trigger bodies, nested CASE and quoted/commented delimiters',async () => {
  const sql = `CREATE TABLE sample(n INTEGER);
    CREATE TRIGGER guard BEFORE INSERT ON sample BEGIN
      -- END; is not a block delimiter in a comment
      SELECT CASE WHEN NEW.n < 0 THEN RAISE(ABORT,'bad; END') END;
      SELECT 'a'';BEGIN';
    END;
    INSERT INTO sample VALUES (1);`;
  const statements = splitSqlStatements(sql);
  assert.equal(statements.length,3);
  const client = createClient({url:'file::memory:'});
  try { for (const statement of statements) await client.execute(statement);
    assert.equal((await client.execute('SELECT COUNT(*) AS n FROM sample')).rows[0].n,1);
    await assert.rejects(client.execute('INSERT INTO sample VALUES (-1)'),/bad; END/);
  } finally { client.close(); }
});
