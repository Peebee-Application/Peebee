import { Check, Circle } from "lucide-react";
export function DeliveryProgress({ stage }: { stage: string }) {
  const current = stage === "Settle" ? 3 : ["Deliver", "Arrived", "Handover"].includes(stage) ? 2 : ["Shop", "Substitute", "Approve"].includes(stage) ? 1 : 0;
  return <ol aria-label="Delivery progress" className="flex items-start py-4">{["Confirmed", "Preparing", "On the way", "Delivered"].map((label, index) => <li key={label} aria-current={current === index ? "step" : undefined} className="relative flex flex-1 flex-col items-center gap-2 text-center">
    <span className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full ${index <= current ? "bg-gold text-ink-gold" : "bg-[rgb(var(--surface-muted))] text-ink-500"}`}>{index < current || current === 3 ? <Check className="h-5 w-5" strokeWidth={3} aria-hidden /> : <Circle className="h-5 w-5" strokeWidth={3} aria-hidden />}</span>
    {index < 3 && <span aria-hidden className={`absolute left-1/2 top-4 h-0.5 w-full ${index < current ? "bg-gold" : "bg-[rgb(var(--surface-muted))]"}`} />}
    <span className={`text-xs ${index <= current ? "font-extrabold" : "text-ink-500"}`}>{label}</span>
  </li>)}</ol>;
}
