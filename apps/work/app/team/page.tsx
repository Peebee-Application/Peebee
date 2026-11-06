"use client";

import type { WorkStaffMember } from "@peebee/shared";
import { Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

export default function TeamPage() {
  const { provider, isOwner } = useAuth();
  const [staff, setStaff] = useState<WorkStaffMember[]>([]);
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api.workStaff().then((r) => setStaff(r.staff)).catch((e) => setError(errorMessage(e))), []);
  useEffect(() => { if (isOwner) load(); }, [isOwner, load]);

  if (provider?.kind !== "company" || !isOwner) return <p className="text-base font-medium text-ink-500">Teams are for company accounts.</p>;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.workAddStaff(identifier.trim());
      setIdentifier("");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(userId: string) {
    setError(null);
    try {
      await api.workRemoveStaff(userId);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="flex items-center gap-2 text-2xl font-black text-ink"><Users className="h-7 w-7 text-gold" aria-hidden /> Team</h1>
      <p className="text-base font-medium text-ink-500">Staff see only the jobs you assign. Payouts go to you.</p>
      {error && <div className="rounded-2xl bg-red-500/10 p-3 text-base font-bold text-red-600" role="alert">{error}</div>}

      <form onSubmit={add} className="home-card space-y-3 p-4">
        <label className="block space-y-1">
          <span className="text-base font-bold text-ink-500">Phone or email</span>
          <input required value={identifier} onChange={(e) => setIdentifier(e.target.value)} className="w-full text-lg font-medium text-ink outline-none" />
        </label>
        <button type="submit" disabled={busy} className="w-full min-h-14 rounded-2xl bg-gold text-lg font-black text-ink-gold transition active:scale-[0.98] disabled:opacity-50">Add team member</button>
      </form>

      {staff.filter((m) => m.status === "active").map((m) => (
        <div key={m.user_id} className="home-card flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="truncate text-lg font-black text-ink">{m.name}</p>
            <p className="text-base font-medium text-ink-500">{m.role === "owner" ? "Owner" : m.phone || "Staff"}</p>
          </div>
          {m.role !== "owner" && (
            <button type="button" aria-label={`Remove ${m.name}`} onClick={() => remove(m.user_id)} className="flex h-14 w-14 items-center justify-center rounded-full text-red-600 transition active:scale-90">
              <Trash2 className="h-6 w-6" aria-hidden />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
