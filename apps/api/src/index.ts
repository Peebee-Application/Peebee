import { serve } from "@hono/node-server";
import app from "./app.js";

const port = Number(process.env.PORT) || 10000;

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`peebee-api listening on :${info.port}`);
});

export default app;
