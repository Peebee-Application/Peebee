import Link from "next/link";
import { causePath, fetchPublicCauses } from "../../lib/public-channels";
import { ugx } from "../../lib/public-share";

export const metadata = { title: "Give | Peebee" };

/** Public give home: lists live causes. Uses the normal app nav, not the wallet track. */
export default async function GivePage() {
  const data = await fetchPublicCauses();
  const causes = data?.causes ?? [];
  return (
    <div className="px-5 pb-8 pt-4">
      <h1 className="text-2xl font-extrabold text-ink">Give</h1>
      <p className="mt-1 text-sm text-ink-500">Support a cause on Peebee.</p>
      {causes.length === 0 ? (
        <p className="mt-8 text-sm text-ink-500">No causes to give to just now.</p>
      ) : (
        <ul className="mt-5 space-y-3">
          {causes.map((c) => (
            <li key={c.id}>
              <Link href={causePath(c.slug)} className="block rounded-3xl bg-[rgb(var(--surface-card))] p-4 shadow-[var(--shadow-card)]">
                <p className="text-base font-extrabold text-ink">{c.title}</p>
                <p className="mt-1 text-sm text-ink-500">{ugx(c.raisedUgx)} raised of {ugx(c.goalUgx)}</p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-[rgb(var(--surface-muted))]">
                  <div className="h-full rounded-full bg-gold" style={{ width: `${Math.min(100, c.percent)}%` }} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
