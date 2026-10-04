export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "peebee-api-staging", env: "staging" });
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  },
};

interface Env {
  STORAGE: R2Bucket;
}
