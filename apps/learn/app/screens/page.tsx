"use client";

import type { TvDevice } from "@peebee/shared";
import { Monitor, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { Button, Chip, EmptyState, Field, Notice, Skeleton, cardCls, controlCls } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { ProChip, ProUpgrade } from "../../components/ProNotice";
import { useTvAccess } from "../../lib/pro";
import { useStudioSettings } from "../../lib/studio-config";

export default function ScreensPage() {
  const settings = useStudioSettings();
  const { status: pro, allowed } = useTvAccess();
  const id = useId();
  const [devices, setDevices] = useState<TvDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setDevices((await api.tvDevices()).devices);
      setError(null);
    } catch (err) {
      setDevices([]);
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
    // The code on the TV's QR picture arrives as ?code=ABC123.
    const fromUrl = new URLSearchParams(window.location.search).get("code");
    if (fromUrl) {
      setCode(fromUrl.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6));
      setAdding(true);
    }
    const timer = setInterval(() => void load(), 8000);
    return () => clearInterval(timer);
  }, [load]);

  async function pair(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.tvPair(code, name.trim() || undefined);
      setNotice(`“${res.device.name}” is connected. It will show the classroom as soon as you start a class.`);
      setCode("");
      setName("");
      setAdding(false);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function rename(device: TvDevice) {
    const next = window.prompt("Name this screen", device.name)?.trim();
    if (!next || next === device.name) return;
    try {
      await api.tvRename(device.id, next);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function remove(device: TvDevice) {
    if (!window.confirm(`Remove “${device.name}”? The TV will show a new pairing code.`)) return;
    try {
      await api.tvRemove(device.id);
      setNotice("Screen removed.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const full = (devices?.length ?? 0) >= settings.maxScreensPerUser;

  return (
    <div className="space-y-5 pb-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-base font-bold uppercase tracking-wider text-gold">
            Peebee TV <ProChip status={pro} />
          </p>
          <h2 className="font-display text-2xl font-semibold text-ink">Your screens</h2>
          <p className="text-lg text-ink-500">Open Peebee TV on a smart TV, then connect it here with the code it shows.</p>
        </div>
        {!adding && (
          <Button onClick={() => setAdding(true)} disabled={full || !settings.liveEnabled || !allowed}>
            <Plus className="h-4 w-4" aria-hidden /> Add a screen
          </Button>
        )}
      </header>

      {pro && <ProUpgrade status={pro} />}
      {!settings.liveEnabled && <Notice tone="info">Live classroom is switched off right now.</Notice>}
      {full && !adding && <Notice tone="info">You&apos;ve connected the most screens allowed ({settings.maxScreensPerUser}). Remove one to add another.</Notice>}
      {notice && (
        <Notice tone="success" onClose={() => setNotice(null)}>
          {notice}
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}

      {adding && (
        <form onSubmit={pair} className={`${cardCls} space-y-4 p-4 sm:p-5`}>
          <h3 className="text-base font-semibold text-ink">Add a screen</h3>
          <p className="text-lg text-ink-500">
            On the TV, open the browser and go to <strong className="text-ink">tv.peebee.online</strong>. It shows a 6-character code.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Code on the TV" htmlFor={`${id}-code`}>
              <input
                id={`${id}-code`}
                required
                autoComplete="off"
                autoCapitalize="characters"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                className={`${controlCls} font-mono text-lg font-bold tracking-[0.25em]`}
                placeholder="ABC234"
              />
            </Field>
            <Field label="Name (optional)" htmlFor={`${id}-name`} hint="Like “Hall TV” or “Room 4”">
              <input id={`${id}-name`} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} className={controlCls} />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || code.length !== 6}>
              {busy ? "Connecting…" : "Connect screen"}
            </Button>
            <Button variant="secondary" onClick={() => setAdding(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {devices === null ? (
        <Skeleton className="h-28" />
      ) : devices.length === 0 ? (
        !adding && (
          <EmptyState icon={Monitor} title="No screens yet" body="Connect a smart TV and your classes can show lessons, questions and results on the big screen while students answer on their phones." action={<Button onClick={() => setAdding(true)} disabled={!allowed}>Add a screen</Button>} />
        )
      ) : (
        <ul className="space-y-2">
          {devices.map((d) => (
            <li key={d.id} className={`${cardCls} flex flex-wrap items-center justify-between gap-3 p-4`}>
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gold/15 text-gold">
                  <Monitor className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold text-ink">{d.name}</p>
                  <p className="truncate text-base text-ink-500">{d.sessionTitle ? `Showing “${d.sessionTitle}”` : "Free"}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Chip tone={d.online ? "green" : "muted"}>{d.online ? "Online" : "Offline"}</Chip>
                <button type="button" aria-label={`Rename ${d.name}`} onClick={() => void rename(d)} className="rounded-lg p-2 text-ink-500 hover:bg-[rgb(var(--surface-muted))] hover:text-ink">
                  <Pencil className="h-4 w-4" />
                </button>
                <button type="button" aria-label={`Remove ${d.name}`} onClick={() => void remove(d)} className="rounded-lg p-2 text-ink-500 hover:bg-[rgb(var(--surface-muted))] hover:text-red-600">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
