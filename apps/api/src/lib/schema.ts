import { db } from "../db/client.js";

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

export async function hasColumn(table: "menu_items" | "list_items" | "users" | "riders" | "restaurants" | "merchants" | "merchant_outlets" | "order_applications" | "orders" | "car_bookings" | "ai_api_keys" | "car_partners" | "vehicle_assignments" | "rental_listings" | "rentals" | "vehicles", column: string): Promise<boolean> {
  const key = `${table}.${column}`;
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
export async function hasTable(table: "food_item_reviews" | "merchants" | "merchant_outlets" | "car_bookings" | "vehicle_categories" | "car_withdrawals" | "scheduled_checks" | "carpool_trips" | "rentals" | "saved_passengers" | "vehicle_photos" | "ai_api_keys" | "ai_key_limits" | "car_partner_documents" | "driver_requests" | "email_api_keys" | "email_api_usage" | "onboarding_accounts" | "sales_agents" | "sales_agent_requests"): Promise<boolean> {
  const key = `table.${table}`;
  const known = answers.get(key);
  if (known && (known.exists || Date.now() - known.at < NO_TTL_MS)) return known.exists;
  let exists = false;
  try {
    const res = await db.execute({ sql: "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", args: [table] });
    exists = res.rows.length > 0;
  } catch {
    exists = false;
  }
  answers.set(key, { exists, at: Date.now() });
  return exists;
}

/** For tests that swap databases. */
export function resetSchemaCache(): void {
  answers.clear();
}
