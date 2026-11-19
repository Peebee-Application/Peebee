"use client";

import { Palette, Plus, X } from "lucide-react";
import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export type NamedColour = { name: string; hex: string };

/** Names the picker suggests, nearest match wins. */
const NAMED: NamedColour[] = [
  { name: "Black", hex: "#111111" }, { name: "White", hex: "#ffffff" }, { name: "Grey", hex: "#808080" }, { name: "Light grey", hex: "#c8c8c8" },
  { name: "Charcoal", hex: "#36454f" }, { name: "Silver", hex: "#c0c0c0" }, { name: "Red", hex: "#d92d20" }, { name: "Maroon", hex: "#800000" },
  { name: "Wine", hex: "#722f37" }, { name: "Pink", hex: "#ec4899" }, { name: "Light pink", hex: "#f9c6d3" }, { name: "Coral", hex: "#ff7f50" },
  { name: "Orange", hex: "#f97316" }, { name: "Peach", hex: "#ffcba4" }, { name: "Yellow", hex: "#facc15" }, { name: "Mustard", hex: "#d4a017" },
  { name: "Gold", hex: "#c9a227" }, { name: "Cream", hex: "#f5efe0" }, { name: "Beige", hex: "#d6c3a1" }, { name: "Khaki", hex: "#b5a642" },
  { name: "Tan", hex: "#c19a6b" }, { name: "Brown", hex: "#7c4a2d" }, { name: "Chocolate", hex: "#4b2e1e" }, { name: "Olive", hex: "#6b7c23" },
  { name: "Lime", hex: "#84cc16" }, { name: "Green", hex: "#16a34a" }, { name: "Dark green", hex: "#14532d" }, { name: "Mint", hex: "#98e2c6" },
  { name: "Teal", hex: "#0d9488" }, { name: "Turquoise", hex: "#30d5c8" }, { name: "Sky blue", hex: "#7dd3fc" }, { name: "Blue", hex: "#2563eb" },
  { name: "Royal blue", hex: "#1d4ed8" }, { name: "Navy", hex: "#1e3a8a" }, { name: "Purple", hex: "#7c3aed" }, { name: "Lilac", hex: "#c8a2c8" },
  { name: "Magenta", hex: "#d946ef" },
];
/** Big swatches under the picker. */
export const COMMON: NamedColour[] = ["Green", "Navy", "Maroon", "Beige", "Gold", "Brown", "Pink", "Purple", "Orange", "Grey", "Yellow", "Teal"]
  .map((n) => NAMED.find((c) => c.name === n)!);

function toRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const f = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) || 0) as [number, number, number];
}
const hx = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
function toHex(r: number, g: number, b: number) { return `#${hx(r)}${hx(g)}${hx(b)}`; }

function hsvToHex(h: number, s: number, v: number) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return toHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}
function hexToHsv(hex: string): [number, number, number] {
  const [r, g, b] = toRgb(hex).map((n) => n / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return [(h + 360) % 360, max ? d / max : 0, max];
}

/** Closest colour name ("redmean" distance, good enough for shop labels). */
export function nearestColourName(hex: string) {
  const [r1, g1, b1] = toRgb(hex);
  let best = NAMED[0], bestD = Infinity;
  for (const c of NAMED) {
    const [r2, g2, b2] = toRgb(c.hex);
    const rm = (r1 + r2) / 2, dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
    const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
    if (d < bestD) { bestD = d; best = c; }
  }
  return best.name;
}

export function isLightHex(hex: string) {
  const [r, g, b] = toRgb(hex);
  return r * 0.299 + g * 0.587 + b * 0.114 > 160;
}

/** Bottom sheet: pick any colour, name fills itself, merchant can change the name. */
export function ColourPickerSheet({ onAdd, onClose, taken = [], start = "#16a34a" }: { onAdd: (c: NamedColour) => void; onClose: () => void; taken?: string[]; start?: string }) {
  const [hsv, setHsv] = useState<[number, number, number]>(() => hexToHsv(start));
  const [hexDraft, setHexDraft] = useState(start);
  const [name, setName] = useState(() => nearestColourName(start));
  const [nameTouched, setNameTouched] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const hue = useRef<HTMLDivElement>(null);
  const hex = hsvToHex(hsv[0], hsv[1], hsv[2]);
  const clash = taken.some((t) => t.toLowerCase() === name.trim().toLowerCase());

  const pick = useCallback((next: [number, number, number], fromHex?: string) => {
    setHsv(next);
    const h = fromHex ?? hsvToHex(next[0], next[1], next[2]);
    setHexDraft(h);
    if (!nameTouched) setName(nearestColourName(h));
  }, [nameTouched]);

  function drag(el: HTMLDivElement | null, e: ReactPointerEvent, fn: (x: number, y: number) => void) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    fn(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)));
  }
  const onArea = (e: ReactPointerEvent) => drag(area.current, e, (x, y) => pick([hsv[0], x, 1 - y]));
  const onHue = (e: ReactPointerEvent) => drag(hue.current, e, (x) => pick([Math.min(359.9, x * 360), hsv[1] || 0.8, hsv[2] || 0.8]));

  function add() {
    const n = name.trim().slice(0, 40);
    if (!n || clash) return;
    onAdd({ name: n, hex });
    onClose();
  }

  const lab = "mb-2 block text-[17px] font-extrabold text-ink";
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/55" role="dialog" aria-modal="true" aria-label="Add colour" onClick={onClose}>
      <div className="flex max-h-[94dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[32px] bg-[rgb(var(--surface-card))] shadow-[0_-12px_40px_rgba(0,0,0,0.35)] dark:border-t dark:border-gold/35 dark:bg-[rgb(20_20_20)]" onClick={(e) => e.stopPropagation()} data-testid="colour-picker-sheet">
        <div className="grid h-7 shrink-0 place-items-center"><i className="block h-1.5 w-14 rounded-full bg-ink-500/45" /></div>
        <div className="flex shrink-0 items-center gap-3.5 px-4 pb-3.5">
          <span className="h-[60px] w-[60px] shrink-0 rounded-2xl border-[3px] border-white/90 shadow-[0_0_0_1.5px_rgba(0,0,0,0.25)]" style={{ background: hex }} data-testid="colour-preview" />
          <h3 className="min-w-0 flex-1 break-words text-[26px] font-black leading-tight text-ink">Add colour</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-14 w-14 shrink-0 place-items-center rounded-full border-[1.5px] border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] text-ink"><X className="h-7 w-7" strokeWidth={2.6} /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4 pt-1">
          <div
            ref={area}
            role="slider"
            aria-label="Shade"
            aria-valuenow={Math.round(hsv[1] * 100)}
            tabIndex={0}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); onArea(e); }}
            onPointerMove={(e) => { if (e.buttons) onArea(e); }}
            className="relative h-48 w-full touch-none select-none rounded-3xl"
            style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv[0]} 100% 50%))` }}
            data-testid="colour-area"
          >
            <span className="pointer-events-none absolute h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white shadow-[0_0_0_2px_rgba(0,0,0,0.35)]" style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%`, background: hex }} />
          </div>
          <div
            ref={hue}
            role="slider"
            aria-label="Colour"
            aria-valuenow={Math.round(hsv[0])}
            tabIndex={0}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); onHue(e); }}
            onPointerMove={(e) => { if (e.buttons) onHue(e); }}
            className="relative h-14 w-full touch-none select-none rounded-full"
            style={{ background: "linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)" }}
            data-testid="colour-hue"
          >
            <span className="pointer-events-none absolute top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white shadow-[0_0_0_2px_rgba(0,0,0,0.35)]" style={{ left: `${(hsv[0] / 360) * 100}%`, background: `hsl(${hsv[0]} 100% 50%)` }} />
          </div>
          <div className="grid grid-cols-6 gap-2.5" aria-label="Common colours">
            {COMMON.map((c) => (
              <button key={c.name} type="button" aria-label={c.name} onClick={() => pick(hexToHsv(c.hex), c.hex)} data-testid={`common-${c.name}`}
                className={`aspect-square w-full min-h-12 rounded-full border-[3px] shadow-[0_0_0_1.5px_rgba(0,0,0,0.2)] ${hex === c.hex ? "border-gold ring-4 ring-gold/40" : "border-white/90"}`} style={{ background: c.hex }} />
            ))}
          </div>
          <div>
            <label htmlFor="colour-name" className={lab}>Name</label>
            <div className="field-box flex min-h-[60px] items-center rounded-2xl border-2 border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-4 focus-within:border-gold focus-within:ring-4 focus-within:ring-gold/20">
              <input id="colour-name" value={name} maxLength={40} onChange={(e) => { setName(e.target.value); setNameTouched(true); }} data-testid="colour-name"
                className="min-h-14 w-full min-w-0 bg-transparent text-[21px] font-extrabold text-ink outline-none" />
            </div>
            {clash && <p className="mt-2 text-base font-bold text-red-600 dark:text-red-400">Already added</p>}
          </div>
          <div>
            <label htmlFor="colour-hex" className={lab}><Palette className="mr-1.5 inline h-5 w-5 align-[-3px]" />Code <span className="font-semibold text-ink-500">(optional)</span></label>
            <div className="field-box flex min-h-[60px] items-center rounded-2xl border-2 border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-4 focus-within:border-gold">
              <input id="colour-hex" value={hexDraft} maxLength={7} data-testid="colour-hex" autoCapitalize="off"
                onChange={(e) => { const v = e.target.value.trim(); setHexDraft(v); const h = v.startsWith("#") ? v : `#${v}`; if (/^#[0-9a-f]{6}$/i.test(h)) pick(hexToHsv(h), h.toLowerCase()); }}
                className="min-h-14 w-full min-w-0 bg-transparent font-mono text-[21px] font-bold uppercase text-ink outline-none" />
            </div>
          </div>
        </div>
        <div className="shrink-0 border-t border-[var(--border-faint)] px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-3">
          <button type="button" onClick={add} disabled={!name.trim() || clash} data-testid="colour-add"
            className="flex min-h-16 w-full items-center justify-center gap-2.5 rounded-full bg-gold text-xl font-black text-ink-gold shadow-[0_8px_22px_rgb(var(--gold)/0.35)] disabled:opacity-50">
            <Plus className="h-[26px] w-[26px]" strokeWidth={3} /> Add
          </button>
        </div>
      </div>
    </div>
  );
}
