import { isSessionMarker, markerFor, sessionToken, sessionCookie } from './session.mjs';
// Fixed-origin gateway: customer authentication and all records remain in Peebee.
export async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    url.protocol = 'https:'; url.port = '';
    return Response.redirect(url.href, 308);
  }
  let response;
  if (url.pathname.startsWith('/api/v1/')) {
    const upstream = new URL(env.API_ORIGIN || 'https://api.peebee.online');
    const local = upstream.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(upstream.hostname);
    if ((!local && upstream.origin !== 'https://api.peebee.online') || upstream.username || upstream.password) return new Response('Invalid API origin', { status: 503 });
    const cookie = sessionToken(request);
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    const origin = request.headers.get('origin');
    // SameSite alone does not stop a hostile sibling subdomain. Bearer-only
    // clients remain compatible; cookie writes require the exact app origin.
    if (unsafe && ((origin && origin !== url.origin) || (cookie && origin !== url.origin))) {
      return Response.json({ error: 'origin_rejected' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
    }
    upstream.pathname = url.pathname.slice(4);
    upstream.search = url.search;
    const headers = new Headers();
    for (const name of ['authorization', 'content-type', 'accept', 'idempotency-key', 'user-agent']) {
      if (request.headers.has(name)) headers.set(name, request.headers.get(name));
    }
    const credential = headers.get('authorization')?.replace(/^Bearer /, '');
    let usedCookie = false;
    if (isSessionMarker(credential)) {
      if (cookie && credential !== await markerFor(cookie)) return Response.json({ error: 'session_changed' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
      if (cookie) { headers.set('authorization', `Bearer ${cookie}`); usedCookie = true; }
      else headers.delete('authorization');
    }
    // Cloudflare overwrites this inbound field at the edge. Never accept the
    // caller's X-Real-IP/X-Forwarded-For as an identity fallback.
    const clientIp = request.headers.get('cf-connecting-ip');
    if (clientIp && /^[0-9a-f:.]+$/i.test(clientIp)) headers.set('x-real-ip', clientIp);
    // Support sessions use a separate capability, scoped to the support service.
    if (upstream.pathname.startsWith('/v1/support-chat/') && request.headers.has('x-chat-secret')) {
      headers.set('x-chat-secret', request.headers.get('x-chat-secret'));
    }
    // Do not forward browser cookies, arbitrary destinations, or a secret of our own.
    headers.set('Origin', url.origin);
    try {
      response = await fetch(upstream, {
        method: request.method, headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
        redirect: 'manual',
      });
    } catch {
      response = Response.json({ error: 'upstream_unavailable', message: 'Peebee is temporarily unavailable. Please try again.' }, { status: 502 });
    }
    response = new Response(response.body, response);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.delete('Set-Cookie');
    const logout = upstream.pathname === '/v1/auth/logout';
    if (logout || (usedCookie && response.status === 401)) response.headers.set('Set-Cookie', sessionCookie(''));
    if (response.ok && unsafe && upstream.pathname.startsWith('/v1/auth/') && response.headers.get('content-type')?.includes('application/json')) {
      const data = await response.clone().json().catch(() => null);
      if (data && typeof data.token === 'string' && data.token.length > 0 && data.token.length <= 4096) {
        const token = data.token;
        data.token = await markerFor(token);
        response = Response.json(data, response);
        response.headers.set('Set-Cookie', sessionCookie(token));
      }
    } else if (response.ok && upstream.pathname === '/v1/auth/me') {
      // Migrate an existing valid browser bearer session without signing the
      // customer out. The backend has just authenticated this exact token.
      const auth = request.headers.get('authorization');
      if (auth?.startsWith('Bearer ') && !isSessionMarker(auth.slice(7))) {
        const data = await response.clone().json().catch(() => null);
        if (data?.user) {
          response = Response.json({ ...data, sessionMarker: await markerFor(auth.slice(7)) }, response);
          response.headers.set('Set-Cookie', sessionCookie(auth.slice(7)));
        }
      }
    }
  } else {
    response = await env.ASSETS.fetch(request);
    response = new Response(response.body, response);
    if (url.pathname === '/' || url.pathname.endsWith('.html')) response.headers.set('Cache-Control', 'no-cache');
  }
  response.headers.set('X-Content-Type-Options', 'nosniff');
  if (url.protocol === 'https:') response.headers.set('Strict-Transport-Security', 'max-age=31536000');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(self), payment=()');
  response.headers.set('Content-Security-Policy', [
    "default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'self'",
    "script-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/client https://maps.googleapis.com https://maps.gstatic.com https://api.mapbox.com",
    "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style https://api.mapbox.com",
    "frame-src https://accounts.google.com/gsi/", "img-src 'self' data: blob: https:",
    "font-src 'self' data:", "media-src 'self' blob:", "worker-src 'self' blob:",
    "connect-src 'self' https://accounts.google.com/gsi/ https://tile.openstreetmap.org https://nominatim.openstreetmap.org https://router.project-osrm.org https://maps.googleapis.com https://maps.gstatic.com https://api.mapbox.com https://events.mapbox.com",
  ].join('; '));
  return response;
}
export default { fetch: handleRequest };
