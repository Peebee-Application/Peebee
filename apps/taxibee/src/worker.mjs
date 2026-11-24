// Fixed-origin gateway: customer authentication and all records remain in Peebee.
export async function handleRequest(request, env) {
  const url = new URL(request.url);
  let response;
  if (url.pathname.startsWith('/api/v1/')) {
    const upstream = new URL(env.API_ORIGIN || 'https://api.peebee.online');
    if (!['https:', 'http:'].includes(upstream.protocol)) return new Response('Invalid API origin', { status: 503 });
    upstream.pathname = url.pathname.slice(4);
    upstream.search = url.search;
    const headers = new Headers();
    for (const name of ['authorization', 'content-type', 'accept', 'idempotency-key', 'user-agent']) {
      if (request.headers.has(name)) headers.set(name, request.headers.get(name));
    }
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
  } else {
    response = await env.ASSETS.fetch(request);
    response = new Response(response.body, response);
    if (url.pathname === '/' || url.pathname.endsWith('.html')) response.headers.set('Cache-Control', 'no-cache');
  }
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(self), payment=()');
  response.headers.set('Content-Security-Policy', "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/client; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; frame-src https://accounts.google.com/gsi/; img-src 'self' data: blob: https:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self' https://accounts.google.com/gsi/ https://tile.openstreetmap.org https://nominatim.openstreetmap.org https://router.project-osrm.org");
  return response;
}
export default { fetch: handleRequest };
