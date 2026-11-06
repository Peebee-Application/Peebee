"use client";

import { HelpSupport } from "@peebee/shared/help-support";
import { getStoredToken } from "../../lib/api";

export default function HelpPage() {
  return (
    <div className="space-y-4 px-4 pb-28 pt-4">
      <header>
        <h1 className="text-xl font-bold text-ink">Help &amp; support</h1>
        <p className="mt-1 text-lg text-ink-500">Ask the Peebee assistant, or talk to someone on the support team.</p>
      </header>
      <HelpSupport app="learn" apiBase={process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:10000"} getToken={getStoredToken} />
    </div>
  );
}
