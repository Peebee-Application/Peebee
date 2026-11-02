import { db } from "../db/client.js";
import { hasTable } from "../lib/schema.js";

type Row = Record<string, unknown>;

/** Records that a staff member has the admin app open, so visitors can be told whether anyone is there. At most one write per 30 seconds each. */
export async function touchAgentPresence(userId: string, name: string): Promise<void> {
  if (!(await hasTable("support_agent_presence"))) return;
  await db.execute({
    sql: `INSERT INTO support_agent_presence (user_id, name, last_seen_at) VALUES (?, ?, datetime('now'))
          ON CONFLICT(user_id) DO UPDATE SET name = excluded.name, last_seen_at = datetime('now') WHERE last_seen_at < datetime('now', '-30 seconds')`,
    args: [userId, name],
  });
}

/** Staff who had the admin app open in the last 90 seconds. Null when it cannot be told (migration 0154 not applied). */
export async function agentsOnline(): Promise<number | null> {
  if (!(await hasTable("support_agent_presence"))) return null;
  const res = await db.execute("SELECT COUNT(*) AS n FROM support_agent_presence WHERE last_seen_at > datetime('now', '-90 seconds')");
  return Number((res.rows[0] as Row).n) || 0;
}
