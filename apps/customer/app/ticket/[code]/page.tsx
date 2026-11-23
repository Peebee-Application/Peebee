"use client";

import { taxipressTown, type PublicTaxipressTicket } from "@peebee/shared";
import { Bus, TicketX } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../lib/api";

const ugx = (n: number) => `UGX ${n.toLocaleString("en-UG")}`;

const STATE: Record<PublicTaxipressTicket["status"], string> = {
  booked: "Ready to travel",
  boarded: "On board",
  completed: "Trip complete",
  cancelled: "Cancelled",
  no_show: "Missed",
};

/** What a ticket code opens: the trip and the seat in large print, for a traveller with no smartphone. Needs no sign-in. */
export default function TicketCodePage() {
  const { code } = useParams<{ code: string }>();
  const entered = decodeURIComponent(code ?? "");
  const [ticket, setTicket] = useState<PublicTaxipressTicket | null>(null);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    api.getTaxipressTicketByCode(entered)
      .then((r) => { if (live) { setTicket(r.ticket); setError(""); } })
      .catch((err) => { if (live) setError(errorMessage(err)); })
      .finally(() => { if (live) setLoaded(true); });
    const timer = window.setTimeout(() => setTick((t) => t + 1), 15_000);
    return () => { live = false; window.clearTimeout(timer); };
  }, [entered, tick]);

  return (
    <main className="mx-auto max-w-md space-y-4 px-4 pb-10 pt-6">
      {!loaded ? (
        <p className="text-sm text-ink-500" role="status">Finding this ticket…</p>
      ) : ticket ? (
        <>
          <section className="home-card space-y-3 border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-6 text-center">
            <Bus className="mx-auto h-9 w-9 text-gold" aria-hidden />
            <p className="text-xs font-bold uppercase tracking-wide text-ink-500">Taxipress ticket</p>
            <p className="font-mono text-4xl font-black tracking-widest text-ink">{ticket.code}</p>
            <h1 className="text-2xl font-black text-ink">{taxipressTown(ticket.route.fromName)} → {taxipressTown(ticket.route.toName)}</h1>
            <p className="text-base font-bold text-gold" role="status">{STATE[ticket.status]}</p>
          </section>
          <section className="home-card space-y-3 border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-6 text-base">
            {ticket.travellerName && <Row label="Passenger" value={ticket.travellerName} />}
            {ticket.bookedBy && <Row label="Bought by" value={ticket.bookedBy} />}
            <Row label="Taxi number" value={ticket.taxi.plate} />
            {ticket.taxi.driverName && <Row label="Driver" value={ticket.taxi.driverName} />}
            <Row label="Seats" value={ticket.children > 0 ? `${ticket.seats} (${ticket.adults} adult${ticket.adults === 1 ? "" : "s"}, ${ticket.children} child${ticket.children === 1 ? "" : "ren"})` : String(ticket.seats)} />
            {!!ticket.seatNumbers?.length && <Row label="Seat numbers" value={ticket.seatNumbers.join(', ')} />}
            {ticket.bags > 0 && <Row label="Bags" value={String(ticket.bags)} />}
            {ticket.assistance && <Row label="Help needed" value={ticket.assistance} />}
            {ticket.amountDue != null && ticket.amountDue > 0 && <Row label="Pay the driver" value={ugx(ticket.amountDue)} />}
            {ticket.status === "booked" && (
              <Row label="Taxi is" value={ticket.taxi.status === "boarding" ? "Boarding now" : ticket.taxi.status === "on_road" ? "On the road" : ticket.taxi.position ? `Number ${ticket.taxi.position} in the line` : "Waiting in the line"} />
            )}
          </section>
          {ticket.status === "booked" && <p className="px-2 text-center text-base font-semibold text-ink">Go to the stage and show this code to the driver of the taxi above.</p>}
        </>
      ) : (
        <section className="home-card space-y-2 border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-6 text-center">
          <TicketX className="mx-auto h-9 w-9 text-ink-500" aria-hidden />
          <h1 className="text-xl font-black text-ink">Ticket not found</h1>
          <p className="text-sm text-ink-500" role="alert">{error || "Check the code and try again."}</p>
        </section>
      )}
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-500">{label}</span>
      <span className="text-right font-bold text-ink">{value}</span>
    </div>
  );
}
