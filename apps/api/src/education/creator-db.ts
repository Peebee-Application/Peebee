import { db } from "../db/client.js";
/** Row lookups deliberately return unknown fields; the DB adapter validates bind values. */
export const creatorDb = {
  execute(query: string | { sql: string; args?: unknown[] }) {
    return db.execute(
      typeof query === "string"
        ? query
        : { sql: query.sql, args: (query.args ?? []) as never },
    );
  },
};
