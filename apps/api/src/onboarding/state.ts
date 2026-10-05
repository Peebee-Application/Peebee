import { db } from '../db/client.js';
import { hasTable } from '../lib/schema.js';

/** Old databases keep their existing auth behaviour until the migration lands. */
export async function isAwaitingActivation(userId: string): Promise<boolean> {
  if (!(await hasTable('onboarding_accounts'))) return false;
  const result = await db.execute({sql:'SELECT 1 FROM onboarding_accounts WHERE user_id = ? AND activated_at IS NULL',args:[userId]});
  return result.rows.length > 0;
}
