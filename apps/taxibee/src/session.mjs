// This marker is deliberately public. It is never a backend credential.
export const SESSION_MARKER = 'taxibee-cookie-session-v1';
export const COOKIE_NAME = '__Host-taxibee-session';
export const isSessionMarker = value => typeof value === 'string' && value.startsWith(SESSION_MARKER + ':');
export async function markerFor(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return SESSION_MARKER + ':' + Array.from(new Uint8Array(digest)).map(n => n.toString(16).padStart(2, '0')).join('');
}
export function sessionToken(request) {
  const values = (request.headers.get('cookie') || '').split(';').map(v => v.trim()).filter(v => v.startsWith(COOKIE_NAME + '='));
  if (values.length !== 1) return null;
  try { return decodeURIComponent(values[0].slice(COOKIE_NAME.length + 1)) || null; } catch { return null; }
}
export function sessionCookie(token) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${token ? 604800 : 0}`;
}
