"use client";

import type { AiKey, AiKeyAddResult, AiKeysOverview } from "@tuma/shared";
import { Crown, KeyRound, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { SettingsPageShell } from "../../../components/SettingsPageShell";
import { api, errorMessage } from "../../../lib/api";

function when(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-UG", { dateStyle: "medium", timeStyle: "short" });
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "gold" | "green" | "grey" | "red" }) {
  const cls = { gold: "bg-gold/20 text-ink", green: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-200", grey: "bg-[rgb(var(--surface-muted))] text-ink-500", red: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-200" }[tone];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${cls}`}>{children}</span>;
}

function KeyRow({ k, busy, run, setNote }: {
  k: AiKey;
  busy: boolean;
  run: <T extends AiKeysOverview>(action: () => Promise<T>, after?: (result: T) => void) => Promise<void>;
  setNote: (note: string | null) => void;
}) {
    return (
      <div className="space-y-2 rounded-xl border border-[var(--border-faint)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-ink">{k.label}</span>
          <span className="text-xs text-ink-500">{k.hint}</span>
          {k.isMaster && <Badge tone="gold">Master</Badge>}
          {k.status === "ready" && <Badge tone="green">Ready</Badge>}
          {k.status === "cooling" && <Badge tone="red">At its limit</Badge>}
          {k.status === "disabled" && <Badge tone="grey">Off</Badge>}
        </div>
        {k.projectTag && <p className="text-xs text-ink-500">Google project: {k.projectTag}</p>}
        {k.limits.length > 0 ? (
          <ul className="space-y-0.5 text-xs text-ink-500">
            {k.limits.map((l) => (
              <li key={l.model}>
                {l.model}: {l.reason.split(" — ")[0]} — back about {when(l.until)}
              </li>
            ))}
          </ul>
        ) : (
          k.status === "cooling" && (
            <p className="text-xs text-ink-500">
              {k.cooldownReason} — back about {when(k.cooldownUntil)}.
            </p>
          )
        )}
        {k.lastError && k.status !== "cooling" && <p className="text-xs text-red-600">{k.lastError}</p>}
        <p className="text-xs text-ink-500">
          Used {k.useCount} time{k.useCount === 1 ? "" : "s"}
          {k.lastUsedAt ? ` · last ${when(k.lastUsedAt)}` : ""}
          {k.failCount > 0 ? ` · ${k.failCount} limit hit${k.failCount === 1 ? "" : "s"}` : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          {!k.isMaster && (
            <button type="button" disabled={busy} onClick={() => void run(() => api.adminSetMasterAiKey(k.id))} className="flex min-h-8 items-center gap-1 rounded-full border border-[var(--border-faint)] px-3 text-xs font-bold text-ink">
              <Crown className="h-3.5 w-3.5 text-gold" aria-hidden /> Make master
            </button>
          )}
          {k.isMaster && (
            <button type="button" disabled={busy} onClick={() => void run(() => api.adminSetMasterAiKey(null))} className="min-h-8 rounded-full border border-[var(--border-faint)] px-3 text-xs font-bold text-ink">
              Not master
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => void run(() => api.adminUpdateAiKey(k.id, { enabled: !k.enabled }))} className="min-h-8 rounded-full border border-[var(--border-faint)] px-3 text-xs font-bold text-ink">
            {k.enabled ? "Turn off" : "Turn on"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const next = window.prompt("Which Google project is this key from? Keys from the same project share one limit. Leave empty if it has its own project.", k.projectTag ?? "");
              if (next !== null) void run(() => api.adminUpdateAiKey(k.id, { projectTag: next.trim() || null }));
            }}
            className="min-h-8 rounded-full border border-[var(--border-faint)] px-3 text-xs font-bold text-ink"
          >
            Project
          </button>
          {k.status === "cooling" && (
            <button type="button" disabled={busy} onClick={() => void run(() => api.adminResetAiKey(k.id))} className="flex min-h-8 items-center gap-1 rounded-full border border-[var(--border-faint)] px-3 text-xs font-bold text-ink">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Use again now
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => void run(() => api.adminTestAiKey(k.id), (res) => setNote(`${k.label}: ${res.result.detail}`))} className="min-h-8 rounded-full border border-[var(--border-faint)] px-3 text-xs font-bold text-ink">
            Test
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Remove ${k.label} (${k.hint})?`)) void run(() => api.adminDeleteAiKey(k.id));
            }}
            aria-label={`Remove ${k.label}`}
            className="flex h-8 w-8 items-center justify-center rounded-full text-red-600"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    );
  }

export default function AiKeysPage() {
  const [data, setData] = useState<AiKeysOverview | null>(null);
  const [text, setText] = useState("");
  const [projectTag, setProjectTag] = useState("");
  const [results, setResults] = useState<AiKeyAddResult[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rotationSeconds, setRotationSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .adminAiKeys()
      .then((res) => { setData(res); setRotationSeconds(res.rotationSeconds); })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  async function run<T extends AiKeysOverview>(action: () => Promise<T>, after?: (res: T) => void) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await action();
      setData(res);
      after?.(res);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function add() {
    // One key per line; "Label: key" or just the key.
    const entries = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const named = /^(.{1,60}?)\s*:\s*(\S+)$/.exec(l);
        const tag = projectTag.trim() || undefined;
        return named ? { label: named[1], key: named[2], projectTag: tag } : { key: l, projectTag: tag };
      });
    if (entries.length === 0) return;
    void run(
      () => api.adminAddAiKeys(entries),
      (res) => {
        setResults(res.results);
        if (res.results.every((r) => r.status !== "rejected")) setText("");
      },
    );
  }

  const master = data?.keys.find((k) => k.isMaster);
  const testKeys = data?.keys.filter((k) => !k.isMaster) ?? [];
  const readyTest = testKeys.filter((k) => k.status === "ready").length;


  return (
    <SettingsPageShell title="Google AI keys" loading={loading}>
      {data && (
        <div className="space-y-5">
          {!data.tableReady && (
            <p className="rounded-lg bg-gold/15 px-3 py-2 text-sm text-ink">
              Apply migrations <code>0074_ai_api_keys.sql</code> and <code>0075_ai_key_limits.sql</code> first. Until then the app keeps using the <code>GEMINI_API_KEY</code> secret.
            </p>
          )}
          {data.tableReady && !data.encryptionConfigured && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              <code>CREDENTIALS_ENCRYPTION_KEY</code> isn&apos;t set on the API, so keys can&apos;t be stored safely yet.
            </p>
          )}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {note && <p className="rounded-lg bg-[rgb(var(--surface-muted))] px-3 py-2 text-sm text-ink">{note}</p>}

          <section className="home-card space-y-3">
            <div>
              <h2 className="text-sm font-bold text-ink">Mode</h2>
              <p className="mt-1 text-xs text-ink-500">Used by Luganda list reading (translation and voice).</p>
            </div>
            <div role="tablist" className="grid grid-cols-2 gap-2">
              {(["test", "paid"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={data.mode === m}
                  disabled={busy || data.mode === m}
                  onClick={() => void run(() => api.adminSetAiKeyMode(m))}
                  className={`min-h-11 rounded-full text-sm font-bold ${data.mode === m ? "bg-gold text-ink-gold" : "bg-gold/15 text-ink"}`}
                >
                  {m === "test" ? "Testing" : "Live (master key)"}
                </button>
              ))}
            </div>
            <p className="text-xs text-ink-500">
              {data.mode === "test"
                ? `Testing mode ${data.rotationSeconds > 0 ? `switches keys every ${data.rotationSeconds} seconds` : "rotates keys on each request"}. When a key reaches a model's quota it is set aside and the next takes over. ${readyTest} of ${testKeys.length} test keys ready now. The master key is reserved for live mode.`
                : master
                  ? `Live mode uses only the master key (${master.label}, ${master.hint}). No rotation.`
                  : "Live mode needs a master key."}
            </p>
            <p className="text-xs text-ink-500">API mode is separate from platform live/sandbox mode. Both modes make real Google requests; billing follows the key&apos;s project.</p>
            <label className="block text-xs font-bold text-ink">Rotate testing keys every (seconds)
              <input type="number" min={0} max={86400} step={1} value={rotationSeconds} onChange={(e) => setRotationSeconds(Number(e.target.value))} className="mt-1 w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-sm outline-none focus:border-gold" />
            </label>
            <p className="text-xs text-ink-500">0 rotates on each request. A timed interval keeps using the scheduled key until the next slot, with immediate fallback on quota errors.</p>
            {data.nextRotationAt && <p className="text-xs text-ink-500">Next scheduled switch: {when(data.nextRotationAt)}</p>}
            <button type="button" disabled={busy || !data.tableReady || !Number.isInteger(rotationSeconds) || rotationSeconds < 0 || rotationSeconds > 86400} onClick={() => void run(() => api.adminSetAiKeyRotation(rotationSeconds), (res) => { setRotationSeconds(res.rotationSeconds); setNote("Rotation timer saved."); })} className="min-h-11 w-full rounded-full bg-gold text-sm font-bold text-ink-gold disabled:opacity-50">Save rotation timer</button>
          </section>

          <p className="rounded-lg bg-gold/15 px-3 py-2 text-xs text-ink">
            <span className="font-bold">Good to know:</span> Google limits are per <span className="font-bold">project</span> and per <span className="font-bold">model</span>, not per key. Several keys made in the same Google project share one allowance, so they won&apos;t add capacity. For real rotation, create each key in a <span className="font-bold">separate Google project</span> (in AI Studio, use &ldquo;Create API key&rdquo; with a new project each time). If you do put keys from one project here, give them the same project name below so they&apos;re treated as one.
          </p>

          <section className="home-card space-y-3">
            <div>
              <h2 className="text-sm font-bold text-ink">Add keys</h2>
              <p className="mt-1 text-xs text-ink-500">
                Paste Google AI Studio keys, one per line (optionally <code>Name: key</code>). Add as many as you like. Each is checked with Google before it&apos;s saved and stored encrypted; it can&apos;t be read back.
              </p>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder={"AIza…\nSharon: AIza…"}
              className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 font-mono text-xs outline-none focus:border-gold"
              spellCheck={false}
              autoComplete="off"
            />
            <input
              value={projectTag}
              onChange={(e) => setProjectTag(e.target.value)}
              placeholder="Google project name for these keys (optional)"
              className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-sm outline-none focus:border-gold"
              autoComplete="off"
            />
            <button type="button" disabled={busy || !text.trim() || !data.tableReady} onClick={add} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-gold text-sm font-bold text-ink-gold disabled:opacity-60">
              <KeyRound className="h-4 w-4" aria-hidden /> {busy ? "Checking…" : "Add keys"}
            </button>
            {results.length > 0 && (
              <ul className="space-y-1 text-xs">
                {results.map((r, i) => (
                  <li key={i} className={r.status === "added" ? "text-green-700 dark:text-green-300" : "text-red-600"}>
                    {r.label} ({r.hint}): {r.status === "added" ? "added" : r.status}
                    {r.detail ? ` — ${r.detail}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-bold text-ink">Master key</h2>
            {master ? <KeyRow k={master} busy={busy} run={run} setNote={setNote} /> : <p className="text-xs text-ink-500">None yet. Pick one from the list below with &ldquo;Make master&rdquo;.</p>}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-bold text-ink">Test keys ({testKeys.length})</h2>
            {testKeys.length === 0 ? (
              <p className="text-xs text-ink-500">
                No keys yet.{data.envKeyPresent ? " The GEMINI_API_KEY secret is being used for now." : " Add one above."}
              </p>
            ) : (
              testKeys.map((k) => <KeyRow key={k.id} k={k} busy={busy} run={run} setNote={setNote} />)
            )}
          </section>
        </div>
      )}
      {!data && error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </SettingsPageShell>
  );
}
