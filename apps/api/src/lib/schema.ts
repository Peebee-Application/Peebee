import { db } from "../db/client.js";
import { inPractice } from "../db/practice-context.js";

/**
 * Whether a column exists in the live database. Migrations here are applied by
 * hand, not by the deploy, so new code can reach production before the
 * migration it depends on. Features that add a column use this to fall back to
 * their previous behaviour until it lands, instead of failing every request
 * that touches the table.
 *
 * "Yes" is remembered for the life of the isolate; "no" is re-checked after a
 * short while so the feature switches on soon after the migration is applied.
 */
const answers = new Map<string, { exists: boolean; at: number }>();
const NO_TTL_MS = 30_000;

export async function hasColumn(table: string, column: string): Promise<boolean> {
  if (!/^[a-z0-9_]+$/i.test(table)) return false;
  const key = `${inPractice() ? "practice:" : ""}${table}.${column}`;
  const known = answers.get(key);
  if (known && (known.exists || Date.now() - known.at < NO_TTL_MS)) return known.exists;
  let exists = false;
  try {
    const res = await db.execute({ sql: `SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`, args: [column] });
    exists = res.rows.length > 0;
  } catch {
    exists = false;
  }
  answers.set(key, { exists, at: Date.now() });
  return exists;
}

/** Same idea for a whole table: code that reads a table added by a hand-applied migration. */
export async function hasTable(table: string): Promise<boolean> {
  const key = `${inPractice() ? "practice:" : ""}table.${table}`;
  const known = answers.get(key);
  if (known && (known.exists || Date.now() - known.at < NO_TTL_MS)) return known.exists;
  let exists = false;
  try {
    exists = await tableExistsCheap(table);
  } catch {
    exists = false;
  }
  answers.set(key, { exists, at: Date.now() });
  return exists;
}

/**
 * Does a table exist? Reads only that table's column list (about a dozen rows) through pragma_table_info.
 * Looking the name up in sqlite_master has no index and reads every row of the schema (500+ here), and D1 bills
 * every row read, so those probes alone were most of the daily read allowance. Not cached: callers cache the answer.
 */
export async function tableExistsCheap(name: string): Promise<boolean> {
  if (!/^[a-z0-9_]+$/i.test(name)) return false;
  const res = await db.execute({ sql: `SELECT 1 FROM pragma_table_info('${name}') LIMIT 1`, args: [] });
  return res.rows.length > 0;
}

/** True when every named table exists. For the "is this hand-applied migration in yet" readiness checks. */
export async function tablesExist(names: readonly string[]): Promise<boolean> {
  return (await Promise.all(names.map(tableExistsCheap))).every(Boolean);
}

/** For tests that swap databases. */
export function resetSchemaCache(): void {
  answers.clear();
}
