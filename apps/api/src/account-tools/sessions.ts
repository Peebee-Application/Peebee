import type {Context} from 'hono';
import type {AuthTokenPayload} from '../auth/jwt.js';
import {TOKEN_TTL_SECONDS} from '../auth/jwt.js';
import {db} from '../db/client.js';
import {hasTable} from '../lib/schema.js';
import {getCustomerTools} from './settings.js';
/** Observability only: migration absence/logging failure never breaks existing authentication. Revocation remains in revoked_sessions. */
export async function observeSession(c:Context,p:AuthTokenPayload){
 if(!p.jti||p.guestOrderId||p.practice||!(await hasTable('account_sessions')))return;
 const s=await getCustomerTools();if(!s.sessionsEnabled)return;
 try{await db.execute({sql:`INSERT INTO account_sessions(jti,user_id,user_agent,issued_at,expires_at) VALUES(?,?,?,?,?) ON CONFLICT(jti) DO UPDATE SET last_seen_at=datetime('now') WHERE last_seen_at < datetime('now',?)`,args:[p.jti,p.sub,(c.req.header('User-Agent')||'Unknown browser').slice(0,240),new Date(p.iat*1000).toISOString(),new Date((p.iat+TOKEN_TTL_SECONDS)*1000).toISOString(),'-'+s.sessionUpdateSeconds+' seconds']});}catch{console.warn('Account session observation unavailable');}
}
