import app from "./app.js";
import { setAiBinding, type AiBinding } from "./ai/binding.js";
import { setD1Binding, type D1Database } from "./db/client.js";
import { renewSubscriptions } from "./riders/subscription.js";
import { renewProSubscriptions } from "./riders/pro-subscription.js";
import { sweepProviderOperations } from "./payments/reconciliation.js";
import { setR2Binding, type R2Bucket } from "./storage/r2.js";
import { sweepExpiredOrders } from "./orders/expiry.js";
import { sweepStageEscalations, sweepStageFines, sweepElectionSessions } from "./stages/escalation.js";

/** Minimal local stand-in so we don't need @cloudflare/workers-types (which
 * conflicts with @types/node's DOM-lib globals) just for one field. */
type CfExecutionContext = { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void };

type WorkerEnv = Record<string, unknown> & { DB?: D1Database; RIDER_DOCS?: R2Bucket; AI?: AiBinding };

function bindEnv(env: WorkerEnv): void {
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") process.env[key] = value;
  }
  setD1Binding(env.DB);
  setR2Binding(env.RIDER_DOCS);
  setAiBinding(env.AI);
}

/** Cloudflare Worker entry. `env` carries Worker vars/secrets/bindings —
 * nodejs_compat gives us a `process` global, so mirror the string vars onto
 * process.env once per request and every existing `process.env.X` read in
 * the app keeps working unchanged. The D1 binding (`env.DB`) is registered
 * separately since it isn't a string. */
export default {
  fetch(request: Request, env: WorkerEnv, ctx: CfExecutionContext): Response | Promise<Response> {
    bindEnv(env);
    return app.fetch(request, env as never, ctx as never);
  },
  /** Cloudflare Cron Trigger. The two-minute heartbeat reconciles provider
   * operations whose callbacks were delayed or dropped. The daily trigger
   * additionally renews recurring rider subscriptions. */
  async scheduled(event: { cron?: string }, env: WorkerEnv, ctx: CfExecutionContext): Promise<void> {
    bindEnv(env);
    ctx.waitUntil(
      sweepProviderOperations()
        .then((result) => console.log("Provider reconciliation sweep:", JSON.stringify(result)))
        .catch((err) => console.error("Provider reconciliation sweep failed:", err)),
    );
    ctx.waitUntil(
      sweepStageEscalations()
        .then((result) => console.log("Stage savings escalation sweep:", JSON.stringify(result)))
        .catch((err) => console.error("Stage savings escalation sweep failed:", err)),
    );
    ctx.waitUntil(
      sweepStageFines()
        .then((result) => console.log("Stage savings fines sweep:", JSON.stringify(result)))
        .catch((err) => console.error("Stage savings fines sweep failed:", err)),
    );
    ctx.waitUntil(
      sweepExpiredOrders()
        .then((result) => console.log("Job expiry sweep:", JSON.stringify(result)))
        .catch((err) => console.error("Job expiry sweep failed:", err)),
    );
    ctx.waitUntil(
      sweepElectionSessions()
        .then((result) => console.log("Stage election sweep:", JSON.stringify(result)))
        .catch((err) => console.error("Stage election sweep failed:", err)),
    );
    if (event.cron === "0 3 * * *") {
      ctx.waitUntil(
        renewSubscriptions()
          .then((result) => console.log("Subscription renewal sweep:", JSON.stringify(result)))
          .catch((err) => console.error("Subscription renewal sweep failed:", err)),
      );
      ctx.waitUntil(
        renewProSubscriptions()
          .then((result) => console.log("Pro subscription renewal sweep:", JSON.stringify(result)))
          .catch((err) => console.error("Pro subscription renewal sweep failed:", err)),
      );
    }
  },
};
