import { createClient, type Client, type InArgs } from "@libsql/client/web";
import { inPractice } from "./practice-context.js";

/**
 * Primary DB is Cloudflare D1 (native Worker binding — no HTTP hop, no
 * separate provider). Turso stays supported as a fallback purely for local
 * Node dev (`pnpm --filter api dev`), since a D1 binding only exists inside
 * a Worker. worker.ts registers the D1 binding via `setD1Binding` before
 * each request; if none is registered we fall back to
 * TURSO_DATABASE_URL/TURSO_AUTH_TOKEN (e.g. a local `turso dev` instance).
 *
 * Built lazily (on first query, not at import time) because on Workers the
 * D1 binding / env vars are only available once a request comes in, not at
 * module-load/cold-start time.
 */

type D1Result<T = Record<string, unknown>> = {
  results: T[];
  success: boolean;
  meta: { changes: number; last_row_id: number };
};

type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
};

export type D1Database = {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
};

export type DbStatement = { sql: string; args?: unknown[] };

let d1Binding: D1Database | null = null;
let practiceBinding: D1Database | null = null;

/** Called once per request from worker.ts before any route handler runs. */
export function setD1Binding(binding: D1Database | undefined): void {
  d1Binding = binding ?? null;
}

/**
 * The separate database that holds the shared practice world. While it is bound, everything a practice session reads
 * or writes (`inPractice()`) goes there and never touches live data. When it is not bound the practice world lives in
 * the main database under `prac_` ids, as it did before.
 */
export function setPracticeD1Binding(binding: D1Database | undefined): void {
  practiceBinding = binding ?? null;
}

/** Is the practice world kept in its own database? */
export const hasPracticeDatabase = (): boolean => practiceBinding !== null;

/** The binding this request's queries go to. */
function activeBinding(): D1Database | null {
  return practiceBinding && inPractice() ? practiceBinding : d1Binding;
}

function wrapD1(binding: D1Database): Client {
  return {
    async execute(query: { sql: string; args?: unknown[] } | string) {
      const { sql, args } = typeof query === "string" ? { sql: query, args: [] as unknown[] } : query;
      const stmt = binding.prepare(sql).bind(...(args ?? []));
      const res = await stmt.all();
      return {
        rows: res.results,
        columns: [],
        columnTypes: [],
        rowsAffected: res.meta.changes,
        lastInsertRowid: BigInt(res.meta.last_row_id ?? 0),
        toJSON() {
          return this;
        },
      };
    },
  } as unknown as Client;
}

function buildTursoClient(): Client {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    throw new Error(
      "No D1 binding and TURSO_DATABASE_URL is not set. Copy .env.example to .env.local for local dev (see apps/api/README.md).",
    );
  }

  return createClient({ url, authToken });
}

let cachedTurso: Client | null = null;

function client(): Client {
  const binding = activeBinding();
  if (binding) return wrapD1(binding);
  if (!cachedTurso) cachedTurso = buildTursoClient();
  return cachedTurso;
}

export const db: Client = new Proxy({} as Client, {
  get(_target, prop, receiver) {
    const value = Reflect.get(client(), prop, receiver);
    return typeof value === "function" ? value.bind(client()) : value;
  },
});

/**
 * Always the main database, even inside a practice session. For what belongs to the platform and not to the practice
 * world: the admin switches and settings, so practice follows the real fares, modules and notices.
 */
export const mainDb: Client = new Proxy({} as Client, {
  get(_target, prop, receiver) {
    const target = d1Binding ? wrapD1(d1Binding) : client();
    const value = Reflect.get(target, prop, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  },
});

/**
 * Execute a set of writes atomically. D1 guarantees that `batch` either
 * commits every prepared statement or rolls the whole batch back; libSQL's
 * write batch provides the same property for local development. Financial
 * services use this instead of a sequence of independent `db.execute`
 * calls so a crash can never leave only half of a ledger transaction.
 */
export async function executeBatch(statements: DbStatement[]): Promise<number[]> {
  if (statements.length === 0) return [];
  const binding = activeBinding();
  if (binding) {
    const prepared = statements.map((statement) =>
      binding.prepare(statement.sql).bind(...(statement.args ?? [])),
    );
    const results = await binding.batch(prepared);
    return results.map((result) => result.meta.changes);
  }
  const results = await client().batch(
    statements.map((statement) => ({ sql: statement.sql, args: (statement.args ?? []) as InArgs })),
    "write",
  );
  return results.map((result) => result.rowsAffected);
}
