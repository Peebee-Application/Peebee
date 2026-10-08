import type { Restaurant } from "@peebee/shared";
import { demoFoodRestaurant } from "@peebee/shared/demo-food";
import { db, executeBatch } from "../db/client.js";
import { ensureAccountCode, ensureMerchantCode } from "../lib/profile-codes.js";

const DISABLED_OWNER_HASH = "sandbox-demo-food-account-disabled";

/** Materialize sandbox pickup and financial identities for shared orders.
 * Menus remain fixtures. The owner is suspended and has no real contact. */
export async function ensureSandboxDemoRestaurant(restaurant: Restaurant): Promise<boolean> {
  if (!demoFoodRestaurant(restaurant.id)) return false;
  const merchantId = `${restaurant.id}-merchant`;
  const outletId = `${restaurant.id}-outlet`;
  await executeBatch([
    { sql: `INSERT OR IGNORE INTO users (id, phone, name, password_hash, role, status)
            VALUES (?, 'sandbox-demo-food-owner', 'Sandbox demo restaurant', ?, 'customer', 'suspended')`,
      args: [restaurant.owner_id, DISABLED_OWNER_HASH] },
    { sql: `INSERT OR IGNORE INTO merchants (id, legal_name, display_name, status, trust_tier, environment)
            SELECT ?, ?, ?, 'active', 'standard', 'sandbox' FROM users
            WHERE id = ? AND status = 'suspended' AND password_hash = ?`,
      args: [merchantId, restaurant.name, restaurant.name, restaurant.owner_id, DISABLED_OWNER_HASH] },
    { sql: `INSERT OR IGNORE INTO merchant_outlets (id, merchant_id, category_id, name, code, address, lat, lng)
            SELECT ?, m.id, c.id, ?, ?, ?, ?, ? FROM merchants m, merchant_categories c
            WHERE m.id = ? AND m.environment = 'sandbox' AND c.slug = 'restaurant'`,
      args: [outletId, restaurant.name, `SANDBOX-${restaurant.id}`, restaurant.address, restaurant.lat, restaurant.lng, merchantId] },
    { sql: `INSERT OR IGNORE INTO merchant_balances (merchant_id, environment)
            SELECT id, 'sandbox' FROM merchants WHERE id = ? AND environment = 'sandbox'`, args: [merchantId] },
    { sql: `INSERT OR IGNORE INTO restaurants
              (id, owner_id, name, description, cuisine, address, lat, lng, status, is_open, environment, merchant_id, outlet_id)
            SELECT ?, id, ?, ?, ?, ?, ?, ?, 'active', ?, 'sandbox', ?, ? FROM users
            WHERE id = ? AND status = 'suspended' AND password_hash = ?
              AND EXISTS (SELECT 1 FROM merchant_outlets WHERE id = ? AND merchant_id = ?)`,
      args: [restaurant.id, restaurant.name, restaurant.description, restaurant.cuisine, restaurant.address,
        restaurant.lat, restaurant.lng, restaurant.is_open, merchantId, outletId, restaurant.owner_id, DISABLED_OWNER_HASH, outletId, merchantId] },
  ]);
  await ensureAccountCode(restaurant.owner_id);
  await ensureMerchantCode(merchantId);
  const result = await db.execute({ sql: `SELECT r.owner_id, r.environment, r.status, r.merchant_id, r.outlet_id
      FROM restaurants r JOIN merchants m ON m.id = r.merchant_id JOIN merchant_outlets o ON o.id = r.outlet_id
      WHERE r.id = ? AND m.environment = 'sandbox' AND m.status = 'active' AND o.status = 'active'
        AND o.merchant_id = m.id`, args: [restaurant.id] });
  const row = result.rows[0];
  return row?.owner_id === restaurant.owner_id && row?.environment === "sandbox" && row?.status === "active"
    && row?.merchant_id === merchantId && row?.outlet_id === outletId;
}
