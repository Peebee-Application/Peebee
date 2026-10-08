import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { db } from "./client.js";
import { ensureAccountCode, ensureRiderCode } from "../lib/profile-codes.js";

/** Local demo data: one customer, one verified+online rider, one admin. Password for all: "password123". */
async function run() {
  // These are throwaway accounts with a password everyone can guess, and one
  // of them is an admin. Seeding them anywhere real hands over the platform,
  // so refuse outright rather than trusting whoever runs this to have checked
  // which database their env points at.
  const environment = process.env.ENVIRONMENT ?? "development";
  if (environment !== "development") {
    console.error(
      `Refusing to seed demo accounts: ENVIRONMENT is "${environment}", not "development".\n` +
        "These accounts all share the password \"password123\" and include an admin.",
    );
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash("password123", 10);

  const customerId = randomUUID();
  const riderId = randomUUID();
  const adminId = randomUUID();

  await db.execute({
    sql: `INSERT OR IGNORE INTO users (id, phone, name, password_hash, role, password_set_at)
          VALUES (?, ?, ?, ?, 'customer', datetime('now'))`,
    args: [customerId, "+256700000001", "Sharon", passwordHash],
  });
  await db.execute({
    sql: `INSERT OR IGNORE INTO users (id, phone, name, password_hash, role, password_set_at)
          VALUES (?, ?, ?, ?, 'rider', datetime('now'))`,
    args: [riderId, "+256700000002", "Juma", passwordHash],
  });
  await db.execute({
    sql: `INSERT OR IGNORE INTO users (id, phone, name, password_hash, role, password_set_at)
          VALUES (?, ?, ?, ?, 'admin', datetime('now'))`,
    args: [adminId, "+256700000003", "Admin", passwordHash],
  });
  await db.execute({
    sql: `INSERT OR IGNORE INTO riders (
            user_id, verified, is_online, area, vehicle_info,
            first_name, last_name, stage_address, home_address, stage_lat, stage_lng,
            stage_name, stage_chairman_name, stage_chairman_contact,
            emergency_contact_name, emergency_contact_phone, national_id_key, profile_completed_at
          ) VALUES (?, 1, 1, 'Kololo', 'UBG 123X',
            'Juma', 'Okello', 'Kololo, Kampala', 'Ntinda, Kampala', 0.3476, 32.5825,
            'Kololo Stage', 'Peter Mugisha', '+256700000010',
            'Grace Okello', '+256700000011', 'seed/demo-national-id.jpg', datetime('now'))`,
    args: [riderId],
  });
  for (const phone of ["+256700000001", "+256700000002", "+256700000003"]) {
    const user = await db.execute({ sql: "SELECT id FROM users WHERE phone=?", args: [phone] });
    if (user.rows[0]?.id) await ensureAccountCode(String(user.rows[0].id));
  }
  const seededRider = await db.execute({ sql: "SELECT user_id FROM riders WHERE user_id=?", args: [riderId] });
  if (seededRider.rows[0]?.user_id) await ensureRiderCode(String(seededRider.rows[0].user_id));

  console.log("Seeded demo users (password: password123):");
  console.log(`  customer +256700000001`);
  console.log(`  rider    +256700000002 (verified, online)`);
  console.log(`  admin    +256700000003`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
