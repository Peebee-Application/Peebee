import type { OrderEvent, OrderRow } from "@peebee/shared";
import { Bike, Check, CheckCircle2, MapPin, Package, ShoppingBag } from "lucide-react";

type Step = {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  /** Order stages that satisfy this step — the first matching event's
   * timestamp is shown once the order has reached any of them. */
  matchStages: string[];
};

function stepsFor(order: OrderRow): Step[] {
  const isParcel = order.type === "parcel";
  return [
    { key: "placed", label: "Order Placed", icon: Package, matchStages: ["Create"] },
    {
      key: "shop",
      label: isParcel ? "Picking Up" : "Shopping",
      icon: ShoppingBag,
      matchStages: ["Shop", "Substitute", "Approve"],
    },
    { key: "deliver", label: "On The Way", icon: Bike, matchStages: ["Deliver"] },
    { key: "arrived", label: "Arrived", icon: MapPin, matchStages: ["Arrived"] },
    { key: "done", label: "Delivered", icon: CheckCircle2, matchStages: ["Handover", "Settle"] },
  ];
}

function timestampFor(events: OrderEvent[], stages: string[]): string | null {
  const match = events.find((e) => stages.includes(e.stage));
  return match?.created_at ?? null;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-UG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function OrderTimeline({
  order,
  events,
  statusLabel,
}: {
  order: OrderRow;
  events: OrderEvent[];
  statusLabel: string;
}) {
  const steps = stepsFor(order);
  const currentStepIndex = steps.reduce(
    (idx, step, i) => (step.matchStages.includes(order.stage) ? i : idx),
    order.stage === "Settle" ? steps.length - 1 : 0,
  );
  const isComplete = order.stage === "Settle";

  return (
    <section className="home-card space-y-4">
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-[rgb(var(--surface-muted))] px-3 py-1 text-xs font-semibold text-ink-500">Timeline</span>
        <span
          className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
            isComplete ? "bg-green/15 text-green" : "bg-gold/15 text-gold"
          }`}
        >
          {isComplete && <Check className="h-3 w-3" strokeWidth={3} aria-hidden />}
          {isComplete ? "Delivered" : statusLabel}
        </span>
      </div>

      <ol className="space-y-0">
        {steps.map((step, i) => {
          const timestamp = timestampFor(events, step.matchStages);
          const isDone = i < currentStepIndex || isComplete || timestamp != null;
          const isCurrent = i === currentStepIndex && !isComplete;
          const Icon = step.icon;
          const isLast = i === steps.length - 1;

          return (
            <li key={step.key} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 ${
                    isDone
                      ? "border-green bg-green/10 text-green"
                      : isCurrent
                        ? "border-gold bg-gold/10 text-gold"
                        : "border-[var(--border-faint)] bg-[rgb(var(--surface-card))] text-ink-500/40"
                  }`}
                >
                  <Icon className="h-4 w-4" strokeWidth={2} aria-hidden />
                </span>
                {!isLast && <span className={`mt-1 h-8 w-px ${isDone ? "bg-green/40" : "bg-[var(--border-faint)]"}`} />}
              </div>
              <div className={`pb-6 ${isLast ? "pb-0" : ""}`}>
                <div className="flex items-baseline gap-2">
                  <p className={`text-sm font-bold ${isDone || isCurrent ? "text-ink" : "text-ink-500/60"}`}>
                    {step.label}
                  </p>
                  {timestamp && <span className="text-xs text-ink-500">{formatTimestamp(timestamp)}</span>}
                </div>
                {isCurrent && <p className="text-xs text-gold">In progress</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
