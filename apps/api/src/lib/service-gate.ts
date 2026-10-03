import type { Context } from "hono";
import { SERVICE_PAUSED_LABEL, type ServiceKey } from "./settings.js";

/** Refusal for a request to use a service an admin has switched off. */
export function servicePaused(c: Context, service: ServiceKey) {
  return c.json({ error: "service_paused", service, message: `${SERVICE_PAUSED_LABEL[service]} ${service === "food" ? "is" : "are"} paused right now. Please try again later.` }, 403);
}
