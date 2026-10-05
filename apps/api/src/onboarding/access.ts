import { db, executeBatch } from '../db/client.js';
import { hasTable } from '../lib/schema.js';

export async function salesAccess(userId: string, superAdmin: boolean) {
  if (superAdmin) return 'approved' as const;
  const agent = await db.execute({sql:'SELECT enabled FROM sales_agents WHERE user_id=?',args:[userId]});
  if (agent.rows[0]) return agent.rows[0].enabled === 1 ? 'approved' as const : 'disabled' as const;
  if (!(await hasTable('sales_agent_requests'))) return 'none' as const;
  const request = await db.execute({sql:'SELECT status FROM sales_agent_requests WHERE user_id=?',args:[userId]});
  return (request.rows[0]?.status ?? 'none') as 'pending' | 'approved' | 'rejected' | 'none';
}

/** Google has verified the email of an invited agent. Activation does not grant sales access. */
export async function activateGoogleAgent(userId: string) {
  if (!(await hasTable('onboarding_accounts'))) return;
  await executeBatch([
    {sql:"UPDATE onboarding_accounts SET activated_at=datetime('now') WHERE user_id=? AND account_type='agent' AND activated_at IS NULL",args:[userId]},
    {sql:"UPDATE onboarding_invitations SET consumed_at=datetime('now') WHERE consumed_at IS NULL AND account_id IN (SELECT id FROM onboarding_accounts WHERE user_id=? AND account_type='agent')",args:[userId]},
  ]);
}
