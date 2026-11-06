"use client";

import {
  Award,
  CheckCircle2,
  FileCheck2,
  Lock,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Thermometer,
  UserCheck,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "../../lib/auth-context";

interface TempLog {
  id: string;
  time: string;
  temp: number;
  recordedBy: string;
  status: "normal" | "warning";
}

const INITIAL_LOGS: TempLog[] = [
  { id: "1", time: "Today 08:30 AM", temp: 4.2, recordedBy: "Dr. Sarah", status: "normal" },
  { id: "2", time: "Yesterday 05:00 PM", temp: 4.5, recordedBy: "Dr. Sarah", status: "normal" },
  { id: "3", time: "Yesterday 08:15 AM", temp: 3.9, recordedBy: "Pharm. Brian", status: "normal" },
  { id: "4", time: "11 Oct 05:15 PM", temp: 4.8, recordedBy: "Dr. Sarah", status: "normal" },
];

export default function PharmacyLicensePage() {
  const { pharmacy, pharmacist } = useAuth();
  const [logs, setLogs] = useState<TempLog[]>(INITIAL_LOGS);
  const [newTemp, setNewTemp] = useState("");
  const [logNotice, setLogNotice] = useState<string | null>(null);
  const [showAllLogs, setShowAllLogs] = useState(false);

  const handleAddTemp = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(newTemp);
    if (isNaN(val)) return;

    const newEntry: TempLog = {
      id: String(Date.now()),
      time: "Just now (" + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + ")",
      temp: val,
      recordedBy: pharmacist?.name.split(" ")[1] || "Pharmacist",
      status: val >= 2 && val <= 8 ? "normal" : "warning",
    };

    setLogs([newEntry, ...logs]);
    setNewTemp("");
    setLogNotice("Temperature logged to NDA digital audit register!");
    setTimeout(() => setLogNotice(null), 3000);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <h1 className="flex items-center gap-2 text-2xl font-black text-ink"><ShieldCheck className="h-7 w-7 text-gold" aria-hidden /> Licence</h1>

      {logNotice && (
        <div className="rounded-2xl bg-gold/15 p-3 text-base font-bold text-ink flex items-center gap-2 animate-fade-in">
          <CheckCircle2 className="h-4 w-4 text-gold shrink-0" />
          <span>{logNotice}</span>
        </div>
      )}

      {/* NDA Premises Certificate Card */}
      <section className="home-card !p-5 !border-gold/40 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gold text-ink-gold shadow-md">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <span className="text-sm font-black uppercase tracking-wider text-gold">
                NDA
              </span>
              <h2 className="text-lg font-black text-ink">Premises licence</h2>
              <p className="text-base text-ink-500 font-mono font-bold">
                {pharmacy?.ndaLicenseNumber}
              </p>
            </div>
          </div>

          <span className="rounded-full bg-green-600/15 px-2.5 py-1 text-sm font-black text-green-600">
            Active · 2026
          </span>
        </div>

        <div className="grid grid-cols-1 gap-2 pt-2 border-t border-[var(--border-faint)] text-base">
          <div className="rounded-2xl bg-[rgb(var(--surface-muted))] p-2.5">
            <span className="text-sm font-bold text-ink-500">Classification</span>
            <p className="font-bold text-ink mt-0.5">Class B Community Pharmacy</p>
          </div>
          <div className="rounded-2xl bg-[rgb(var(--surface-muted))] p-2.5">
            <span className="text-sm font-bold text-ink-500">Inspection Status</span>
            <p className="font-bold text-green-600 mt-0.5">Passed & Compliant</p>
          </div>
        </div>
      </section>

      {/* Supervising pharmacist Practicing Certificate */}
      <section className="home-card !p-4 shadow-sm space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold/15 text-gold">
            <UserCheck className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-black text-ink">Supervising pharmacist</h3>
            <p className="text-base font-bold text-gold">{pharmacist?.name}</p>
          </div>
        </div>

        <div className="rounded-2xl bg-[rgb(var(--surface-muted))] p-3 space-y-1.5 text-base">
          <div className="flex flex-col">
            <span className="text-ink-500">Practising licence (APL)</span>
            <strong className="text-ink font-mono">Not on file</strong>
          </div>
          <div className="flex flex-col">
            <span className="text-ink-500">PSU membership</span>
            <strong className="text-ink font-mono">Not on file</strong>
          </div>
          <div className="flex flex-col">
            <span className="text-ink-500">Valid</span>
            <strong className="text-green-600">Through 31 December 2026</strong>
          </div>
        </div>
      </section>

      {/* Cold Chain & Vaccine Refrigerator Log */}
      <section className="home-card !p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-500/15 text-blue-500">
              <Thermometer className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-base font-black text-ink">Fridge log</h3>
              <p className="text-sm text-ink-500">Target 2°C – 8°C</p>
            </div>
          </div>

          <span className="font-mono text-lg font-black text-blue-500">
            {logs[0]?.temp}°C
          </span>
        </div>

        {/* Log input form */}
        <form onSubmit={handleAddTemp} className="flex gap-2">
          <div className="field-box flex-1 rounded-2xl border border-[var(--border-faint)]">
            <input
              type="number"
              step="0.1"
              required
              placeholder="°C"
              value={newTemp}
              onChange={(e) => setNewTemp(e.target.value)}
              className="w-full bg-transparent px-3 py-2 text-base text-ink focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="min-h-14 rounded-2xl bg-gold px-5 text-lg font-black text-ink-gold shadow transition hover:opacity-95 active:scale-95"
          >
            Log
          </button>
        </form>

        {/* History table */}
        <div className="space-y-1.5 pt-1">
          {(showAllLogs ? logs : logs.slice(0, 5)).map((log) => (
            <div
              key={log.id}
              className="flex items-center justify-between rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] px-3 py-2 text-base"
            >
              <div>
                <span className="font-medium text-ink-500">{log.time}</span>
                <span className="text-sm text-ink-500 ml-2">by {log.recordedBy}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono font-black text-ink">{log.temp}°C</span>
                <span
                  className={`h-2 w-2 rounded-full ${
                    log.status === "normal" ? "bg-green-600" : "bg-red-500 animate-pulse"
                  }`}
                />
              </div>
            </div>
          ))}
        </div>
        {logs.length > 5 && !showAllLogs && (
          <button type="button" onClick={() => setShowAllLogs(true)} className="flex min-h-14 w-full items-center justify-center text-lg font-bold text-gold">Show all {logs.length}</button>
        )}
      </section>
    </div>
  );
}
