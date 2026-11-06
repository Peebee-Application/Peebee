"use client";

import { Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { ugx } from "../../lib/format";

type Earnings = Awaited<ReturnType<typeof api.workEarnings>>;

export default function EarningsPage() {
  const [data, setData] = useState<Earnings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.workEarnings().then(setData).catch((e) => setError(errorMessage(e)));
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="flex items-center gap-2 text-2xl font-black text-ink"><Wallet className="h-7 w-7 text-gold" aria-hidden /> Earnings</h1>
      {error && <div className="rounded-2xl bg-red-500/10 p-3 text-base font-bold text-red-600" role="alert">{error}</div>}
      {data && (
        <>
          <div className="home-card space-y-1 p-5">
            <p className="text-base font-bold text-ink-500">Paid</p>
            <p className="text-4xl font-black tabular-nums text-ink">{ugx(data.paidUgx)}</p>
            <p className="text-base font-medium text-ink-500">{data.paidJobs} paid {data.paidJobs === 1 ? "job" : "jobs"}</p>
          </div>
          <div className="home-card space-y-1 p-5">
            <p className="text-base font-bold text-ink-500">Coming up</p>
            <p className="text-3xl font-black tabular-nums text-ink">{ugx(data.upcomingUgx)}</p>
            <p className="text-base font-medium text-ink-500">{data.upcomingJobs} {data.upcomingJobs === 1 ? "job" : "jobs"} booked or waiting</p>
          </div>
          <p className="text-lg text-ink-500">Paid to your Peebee wallet once the customer confirms.</p>
        </>
      )}
    </div>
  );
}
