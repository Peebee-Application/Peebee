import app from "./app.js";
import { setAiBinding, type AiBinding } from "./ai/binding.js";
import { setD1Binding, setPracticeD1Binding, type D1Database } from "./db/client.js";
import { renewSubscriptions } from "./riders/subscription.js";
import { renewProSubscriptions } from "./riders/pro-subscription.js";
import { sweepProviderOperations } from "./payments/reconciliation.js";
import { setR2Binding, type R2Bucket } from "./storage/r2.js";
import { sweepExpiredOrders } from "./orders/expiry.js";
import { sweepScheduledRides } from "./car/scheduled.js";
import { releaseStaleSeats } from "./car/carpool.js";
import { releaseStaleBookings } from "./taxipress/bookings.js";
import { sweepRentalRequests } from "./car/selfdrive.js";
import { sweepWork } from "./work/scheduled.js";
import { sweepTalent } from "./talent/scheduled.js";
import { sweepChannels } from "./channels/scheduled.js";
import { expireStaleVouchers } from "./gas/vouchers.js";
import { sweepStaleReservations } from "./offers/service.js";
import { expireCredit } from "./offers/credit.js";
import { sweepDiscountWallets } from "./offers/discount-wallet.js";
import { sweepIncentives } from "./offers/incentives.js";
import { sweepStageEscalations, sweepStageFines, sweepElectionSessions } from "./stages/escalation.js";
import { sweepActivationMessages } from "./onboarding/service.js";
import { sweepServicePayments } from "./services-platform/payments.js";
import { sweepFoodHours } from "./restaurants/hours.js";
import { sweepSandboxCar } from "./car/sandbox-demo.js";
import { sweepSandboxRelay } from "./relay/sandbox-demo.js";
import { getPlatformEnvironment, practiceWorldRunning } from "./lib/settings.js";
import { runInPractice } from "./db/practice-context.js";
import { topUpDemoOrders } from "./practice/demo-customers.js";

/** Minimal local stand-in so we don't need @cloudflare/workers-types (which
 * conflicts with @types/node's DOM-lib globals) just for one field. */
type CfExecutionContext = { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void };

type WorkerEnv = Record<string, unknown> & { DB?: D1Database; DB_PRACTICE?: D1Database; RIDER_DOCS?: R2Bucket; AI?: AiBinding };

function bindEnv(env: WorkerEnv): void {
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") process.env[key] = value;
  }
  setD1Binding(env.DB);
  setPracticeD1Binding(env.DB_PRACTICE);
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
    // Practice on each person's device (the default) and a live platform need none of the demo-world work below, which is
    // most of what this job reads from the database. It runs only while Admin switched on the shared practice world, or the
    // whole platform is in sandbox.
    const worldOn = await practiceWorldRunning().catch(() => false);
    const sandboxOn = await getPlatformEnvironment().then((e) => e === "sandbox").catch(() => false);
    // The shared practice world keeps itself busy: demo customers place orders for practising riders, merchants and restaurants.
    if (worldOn) ctx.waitUntil(runInPractice(() => topUpDemoOrders(4)).catch((err) => console.error("Practice top-up failed:", err)));
    ctx.waitUntil(sweepFoodHours().catch((err) => console.error("Food hours sweep failed:", err)));
    ctx.waitUntil(sweepServicePayments().catch((err) => console.error("Service payment sweep failed:", err)));
    ctx.waitUntil(sweepActivationMessages().catch(() => console.error('Activation message retry failed')));
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
      sweepScheduledRides()
        .then((result) => console.log("Scheduled car ride sweep:", JSON.stringify(result)))
        .catch((err) => console.error("Scheduled car ride sweep failed:", err)),
    );
    ctx.waitUntil(
      releaseStaleSeats()
        .then((seats) => console.log("Carpool seat release sweep:", seats))
        .catch((err) => console.error("Carpool seat release sweep failed:", err)),
    );
    ctx.waitUntil(
      releaseStaleBookings()
        .then((seats) => console.log("Taxipress seat release sweep:", seats))
        .catch((err) => console.error("Taxipress seat release sweep failed:", err)),
    );
    ctx.waitUntil(
      sweepWork()
        .then((r) => console.log("Peebee Work sweep:", JSON.stringify(r)))
        .catch((err) => console.error("Peebee Work sweep failed:", err)),
    );
    ctx.waitUntil(
      sweepTalent()
        .then((r) => console.log("Peebee Hire sweep:", JSON.stringify(r)))
        .catch((err) => console.error("Peebee Hire sweep failed:", err)),
    );
    ctx.waitUntil(
      sweepChannels()
        .then((r) => console.log("Channels sweep:", JSON.stringify(r)))
        .catch((err) => console.error("Channels sweep failed:", err)),
    );
    ctx.waitUntil(
      expireStaleVouchers()
        .then((n) => console.log("Fuel voucher expiry sweep:", n))
        .catch((err) => console.error("Fuel voucher expiry sweep failed:", err)),
    );
    ctx.waitUntil(
      sweepRentalRequests()
        .then((n) => console.log("Self-drive request sweep:", n))
        .catch((err) => console.error("Self-drive request sweep failed:", err)),
    );
    if (sandboxOn) ctx.waitUntil(
      sweepSandboxRelay()
        .then((steps) => console.log("Sandbox relay demo sweep:", steps))
        .catch((err) => console.error("Sandbox relay demo sweep failed:", err)),
    );
    if (sandboxOn) ctx.waitUntil(
      sweepSandboxCar()
        .then((steps) => console.log("Sandbox car demo sweep:", steps))
        .catch((err) => console.error("Sandbox car demo sweep failed:", err)),
    );
    // The practice world's demo drivers and relay riders play their steps too, as they do in a sandbox platform.
    if (worldOn) ctx.waitUntil(runInPractice(async () => { await sweepSandboxRelay(); await sweepSandboxCar(); }).catch((err) => console.error("Practice demo sweep failed:", err)));
    ctx.waitUntil(
      sweepElectionSessions()
        .then((result) => console.log("Stage election sweep:", JSON.stringify(result)))
        .catch((err) => console.error("Stage election sweep failed:", err)),
    );
    // Offers: release reservations that never got paid, expire old credit, clear rider discount wallets, pay period incentives.
    ctx.waitUntil(
      Promise.all([sweepStaleReservations(), expireCredit(), sweepDiscountWallets(), sweepIncentives()])
        .then((r) => console.log("Offers sweep:", JSON.stringify(r)))
        .catch((err) => console.error("Offers sweep failed:", err)),
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
