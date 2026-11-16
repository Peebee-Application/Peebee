export function GET() {
  return new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Peebee Admin session</title><script defer src="/financial-session.js"></script></head><body></body></html>', {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; script-src 'self'; connect-src https://api.peebee.online; frame-ancestors https://financials.peebee.online; base-uri 'none'; form-action 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
