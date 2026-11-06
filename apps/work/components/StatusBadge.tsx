import type { WorkJobStatus } from "@peebee/shared";
import { STATUS_LABEL } from "../lib/format";

const TONE: Partial<Record<WorkJobStatus, string>> = {
  open: "bg-gold/15 text-gold",
  assigned: "bg-gold/15 text-gold",
  quoted: "bg-gold/15 text-gold",
  booked: "bg-green/15 text-green",
  in_progress: "bg-green/15 text-green",
  completed: "bg-gold/15 text-gold",
  settled: "bg-green/15 text-green",
  disputed: "bg-red-500/15 text-red-600",
};

export function StatusBadge({ status }: { status: WorkJobStatus }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-sm font-black ${TONE[status] ?? "bg-black/5 text-ink-500"}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}
