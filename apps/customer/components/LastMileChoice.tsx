"use client";

export type LastMileChoiceValue = "door" | "collect" | "meet";

export type MeetStageOption = { id: string; name: string; distanceKm: number; isStation: boolean };

/** The stage to send: the chosen one while it's still offered, else the nearest. */
export function pickMeetStageId(stages: MeetStageOption[] | null | undefined, chosen: string | null | undefined): string | undefined {
  if (!stages || stages.length === 0) return undefined;
  return stages.find((stage) => stage.id === chosen)?.id ?? stages[0].id;
}

/**
 * Relay to a petrol station: a rider to the door, the customer collects there,
 * or (when offered) they meet the matatu at a stage on its route.
 * Without `choiceAtOrder` door/collect is decided on arrival, so only "meet" is a choice now.
 */
export function LastMileChoice({
  value,
  onChange,
  stationName,
  doorTotal,
  collectTotal,
  choiceAtOrder = true,
  meetStages,
  meetStageId,
  onMeetStageChange,
  disabled,
}: {
  value: LastMileChoiceValue;
  onChange: (value: LastMileChoiceValue) => void;
  stationName: string;
  doorTotal: number;
  collectTotal: number;
  choiceAtOrder?: boolean;
  meetStages?: MeetStageOption[] | null;
  meetStageId?: string | null;
  onMeetStageChange?: (id: string) => void;
  disabled?: boolean;
}) {
  const stages = meetStages ?? [];
  const canMeet = stages.length > 0;
  const options: Array<{ value: LastMileChoiceValue; label: string; total: number }> = choiceAtOrder
    ? [
        { value: "door", label: "Deliver to my door", total: doorTotal },
        { value: "collect", label: `I'll collect at ${stationName}`, total: collectTotal },
      ]
    : [{ value: "door", label: `Collect at ${stationName} or send a rider`, total: collectTotal }];
  if (canMeet) options.push({ value: "meet", label: "Meet the matatu at a stage", total: collectTotal });
  const current: LastMileChoiceValue = value === "meet" && !canMeet ? "door" : !choiceAtOrder && value === "collect" ? "door" : value;
  const selectedStage = pickMeetStageId(stages, meetStageId);

  function choose(next: LastMileChoiceValue) {
    onChange(next);
    if (next === "meet" && selectedStage && selectedStage !== meetStageId) onMeetStageChange?.(selectedStage);
  }

  return (
    <div role="radiogroup" aria-label="Last stop" className="space-y-1.5">
      {options.map((option) => {
        const selected = current === option.value;
        return (
          <div key={option.value} className="space-y-1.5">
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => choose(option.value)}
              className="select-card !flex-row items-center gap-2 text-left"
            >
              <span
                className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 ${selected ? "border-gold bg-gold" : "border-[var(--border-faint)]"}`}
                aria-hidden
              />
              <span className="select-card__title min-w-0 flex-1 text-sm text-ink">{option.label}</span>
              <span className="shrink-0 whitespace-nowrap text-sm font-bold text-ink">UGX {option.total.toLocaleString("en-UG")}</span>
            </button>
            {option.value === "meet" && (
              <p className="px-1 text-[11px] text-ink-500">The matatu can&apos;t wait. If you miss it, collect at {stationName}.</p>
            )}
            {option.value === "meet" && selected && (
              <div role="radiogroup" aria-label="Stage" className="space-y-1 pl-5">
                {stages.map((stage) => {
                  const on = stage.id === selectedStage;
                  return (
                    <button
                      key={stage.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={disabled}
                      onClick={() => onMeetStageChange?.(stage.id)}
                      className="select-card !flex-row items-center gap-2 !p-2.5 text-left"
                    >
                      <span
                        className={`h-3 w-3 shrink-0 rounded-full border-2 ${on ? "border-gold bg-gold" : "border-[var(--border-faint)]"}`}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate text-xs text-ink">
                        {stage.name}
                        {stage.isStation && <span className="font-normal text-ink-500"> · petrol station</span>}
                      </span>
                      <span className="shrink-0 whitespace-nowrap text-xs font-normal text-ink-500">{formatKm(stage.distanceKm)} away</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatKm(km: number): string {
  if (!Number.isFinite(km)) return "";
  if (km < 1) return `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}
