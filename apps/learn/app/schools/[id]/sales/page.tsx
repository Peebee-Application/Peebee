"use client";

import type { SalesOverview, StudioBundle, StudioCourse, StudioPlan, StudioSchool } from "@peebee/shared";
import { Plus, Ticket, Trash2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { Button, Chip, Crumbs, Field, Notice, Skeleton, cardCls, controlCls } from "../../../../components/ui";
import { api, errorMessage } from "../../../../lib/api";
import { useStudioSettings } from "../../../../lib/studio-config";
import { formatMoney } from "../../../../lib/streams";

type Tab = "coupons" | "bundles" | "plans";

export default function SalesPage() {
  const { id } = useParams<{ id: string }>();
  const settings = useStudioSettings();
  const fid = useId();
  const [school, setSchool] = useState<StudioSchool | null>(null);
  const [sales, setSales] = useState<SalesOverview | null>(null);
  const [courses, setCourses] = useState<StudioCourse[]>([]);
  const [tab, setTab] = useState<Tab>("coupons");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // coupon form
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<"percent" | "amount">("percent");
  const [off, setOff] = useState("10");
  const [couponCourse, setCouponCourse] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [expires, setExpires] = useState("");
  // bundle form
  const [bundle, setBundle] = useState<{ id: string | null; title: string; summary: string; price: string; courseIds: string[]; status: "draft" | "published" } | null>(null);
  // plan form
  const [plan, setPlan] = useState<{ id: string | null; title: string; summary: string; price: string; days: string; status: "draft" | "published" } | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, list] = await Promise.all([api.studioSchool(id), api.studioSales(id)]);
      setSchool(s.school);
      setSales(list);
      const classes = await api.studioClasses(id);
      const all = await Promise.all(classes.classes.map((c) => api.studioCourses(c.id).then((r) => r.courses)));
      setCourses(all.flat());
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>, done: string, after?: () => void) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      after?.();
      await load();
      setNotice(done);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function addCoupon(e: FormEvent) {
    e.preventDefault();
    const n = Number(off);
    void run(
      () =>
        api.studioCreateCoupon(id, {
          code,
          percentOff: kind === "percent" ? n : null,
          amountOffUgx: kind === "amount" ? n : null,
          courseId: couponCourse || null,
          maxUses: maxUses ? Number(maxUses) : null,
          expiresAt: expires ? new Date(expires).toISOString() : null,
        }),
      "Coupon created.",
      () => setCode(""),
    );
  }

  function saveBundle(e: FormEvent) {
    e.preventDefault();
    if (!bundle) return;
    void run(() => api.studioSaveBundle(id, bundle.id, { title: bundle.title, summary: bundle.summary, priceUgx: Number(bundle.price), courseIds: bundle.courseIds, status: bundle.status }), "Bundle saved.", () => setBundle(null));
  }

  function savePlan(e: FormEvent) {
    e.preventDefault();
    if (!plan) return;
    void run(() => api.studioSavePlan(id, plan.id, { title: plan.title, summary: plan.summary, priceUgx: Number(plan.price), days: Number(plan.days), status: plan.status }), "Pass saved.", () => setPlan(null));
  }

  if (!school && !error) return <Skeleton className="h-64" />;
  const titleOf = (cid: string | null) => courses.find((c) => c.id === cid)?.title ?? "any course";

  return (
    <div className="space-y-5 pb-6">
      <Crumbs items={[{ label: "Schools", href: "/schools" }, { label: school?.name ?? "School", href: `/schools/${id}` }, { label: "Sales tools" }]} />
      <header className={`${cardCls} space-y-1 p-4`}>
        <h2 className="font-display text-2xl font-semibold text-ink">Sales tools</h2>
        <p className="text-lg text-ink-500">Discount codes, course bundles and school passes. Money goes to your wallet, less Peebee&apos;s {settings.commissionPercent}% share.</p>
      </header>
      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice tone="success" onClose={() => setNotice(null)}>{notice}</Notice>}
      {sales && !sales.ready && <Notice tone="info">These tools need a platform update that hasn&apos;t finished yet. Try again shortly.</Notice>}

      <div role="tablist" className="flex gap-2">
        {(["coupons", "bundles", "plans"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-full border px-4 py-2 text-lg font-semibold ${tab === t ? "border-gold bg-gold/15 text-ink" : "border-[var(--border-faint)] text-ink-500"}`}>
            {t === "coupons" ? "Coupons" : t === "bundles" ? "Bundles" : "School passes"}
          </button>
        ))}
      </div>

      {tab === "coupons" && settings.couponsEnabled && (
        <section className="space-y-4">
          <form onSubmit={addCoupon} className={`${cardCls} space-y-3 p-4`}>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-ink"><Ticket className="h-4 w-4 text-gold" aria-hidden /> New coupon</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Code" htmlFor={`${fid}-code`}>
                <input id={`${fid}-code`} required maxLength={40} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className={controlCls} placeholder="WELCOME20" />
              </Field>
              <Field label="Takes off" htmlFor={`${fid}-kind`}>
                <select id={`${fid}-kind`} value={kind} onChange={(e) => setKind(e.target.value as "percent" | "amount")} className={controlCls}>
                  <option value="percent">A percentage</option>
                  <option value="amount">A fixed amount (UGX)</option>
                </select>
              </Field>
              <Field label={kind === "percent" ? `Percent (up to ${settings.maxCouponPercent})` : "Amount (UGX)"} htmlFor={`${fid}-off`}>
                <input id={`${fid}-off`} required type="number" min={1} inputMode="numeric" value={off} onChange={(e) => setOff(e.target.value)} className={controlCls} />
              </Field>
              <Field label="For" htmlFor={`${fid}-for`}>
                <select id={`${fid}-for`} value={couponCourse} onChange={(e) => setCouponCourse(e.target.value)} className={controlCls}>
                  <option value="">Any course of this school</option>
                  {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </Field>
              <Field label="Uses in total (optional)" htmlFor={`${fid}-max`}>
                <input id={`${fid}-max`} type="number" min={1} inputMode="numeric" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} className={controlCls} />
              </Field>
              <Field label="Last day (optional)" htmlFor={`${fid}-exp`}>
                <input id={`${fid}-exp`} type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} className={controlCls} />
              </Field>
            </div>
            <Button type="submit" disabled={busy}><Plus className="h-4 w-4" aria-hidden /> Create coupon</Button>
          </form>
          <ul className="space-y-2">
            {sales?.coupons.map((c) => (
              <li key={c.id} className={`${cardCls} flex flex-wrap items-center justify-between gap-3 p-3`}>
                <div className="min-w-0">
                  <p className="font-mono text-lg font-bold text-ink">{c.code}</p>
                  <p className="text-base text-ink-500">
                    {c.percentOff !== null ? `${c.percentOff}% off` : `${formatMoney(c.amountOffUgx ?? 0)} off`} · {titleOf(c.courseId)} · used {c.usedCount}{c.maxUses ? ` of ${c.maxUses}` : ""}
                    {c.expiresAt ? ` · until ${new Date(c.expiresAt).toLocaleDateString("en-UG")}` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Chip tone={c.active ? "green" : "muted"}>{c.active ? "On" : "Off"}</Chip>
                  <Button variant="secondary" className="!min-h-8 !px-3 !text-base" disabled={busy} onClick={() => void run(() => api.studioSetCouponActive(c.id, !c.active), c.active ? "Coupon switched off." : "Coupon switched on.")}>{c.active ? "Switch off" : "Switch on"}</Button>
                  <button type="button" aria-label={`Delete ${c.code}`} disabled={busy} onClick={() => window.confirm(`Delete ${c.code}?`) && void run(() => api.studioDeleteCoupon(c.id), "Coupon removed.")} className="rounded-lg p-2 text-ink-500 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "bundles" && settings.bundlesEnabled && (
        <section className="space-y-4">
          {bundle ? (
            <form onSubmit={saveBundle} className={`${cardCls} space-y-3 p-4`}>
              <h3 className="text-lg font-semibold text-ink">{bundle.id ? "Edit bundle" : "New bundle"}</h3>
              <Field label="Title" htmlFor={`${fid}-bt`}><input id={`${fid}-bt`} required maxLength={120} value={bundle.title} onChange={(e) => setBundle({ ...bundle, title: e.target.value })} className={controlCls} /></Field>
              <Field label="What's in it (optional)" htmlFor={`${fid}-bs`}><textarea id={`${fid}-bs`} rows={2} maxLength={2000} value={bundle.summary} onChange={(e) => setBundle({ ...bundle, summary: e.target.value })} className={controlCls} /></Field>
              <Field label="Price (UGX)" htmlFor={`${fid}-bp`}><input id={`${fid}-bp`} required type="number" min={0} inputMode="numeric" value={bundle.price} onChange={(e) => setBundle({ ...bundle, price: e.target.value })} className={controlCls} /></Field>
              <fieldset className="space-y-1.5">
                <legend className="text-base font-semibold text-ink-500">Courses (pick at least two, up to {settings.maxBundleCourses})</legend>
                {courses.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-lg text-ink">
                    <input type="checkbox" checked={bundle.courseIds.includes(c.id)} onChange={(e) => setBundle({ ...bundle, courseIds: e.target.checked ? [...bundle.courseIds, c.id] : bundle.courseIds.filter((x) => x !== c.id) })} className="h-4 w-4 accent-[rgb(var(--color-gold))]" />
                    {c.title} <span className="text-base text-ink-500">({formatMoney(c.priceUgx)})</span>
                  </label>
                ))}
              </fieldset>
              <label className="flex items-center gap-2 text-lg text-ink"><input type="checkbox" checked={bundle.status === "published"} onChange={(e) => setBundle({ ...bundle, status: e.target.checked ? "published" : "draft" })} className="h-4 w-4 accent-[rgb(var(--color-gold))]" /> On sale now</label>
              <div className="flex gap-2"><Button type="submit" disabled={busy}>Save bundle</Button><Button variant="secondary" onClick={() => setBundle(null)}>Cancel</Button></div>
            </form>
          ) : (
            <Button onClick={() => setBundle({ id: null, title: "", summary: "", price: "0", courseIds: [], status: "draft" })}><Plus className="h-4 w-4" aria-hidden /> New bundle</Button>
          )}
          <ul className="space-y-2">
            {sales?.bundles.map((b: StudioBundle) => (
              <li key={b.id} className={`${cardCls} flex flex-wrap items-center justify-between gap-3 p-3`}>
                <div className="min-w-0">
                  <p className="text-lg font-semibold text-ink">{b.title}</p>
                  <p className="text-base text-ink-500">{formatMoney(b.priceUgx)} · {b.courseIds.length} courses · {b.sold} sold</p>
                </div>
                <div className="flex gap-2">
                  <Chip tone={b.status === "published" ? "green" : "muted"}>{b.status === "published" ? "On sale" : "Draft"}</Chip>
                  <Button variant="secondary" className="!min-h-8 !px-3 !text-base" onClick={() => setBundle({ id: b.id, title: b.title, summary: b.summary, price: String(b.priceUgx), courseIds: b.courseIds, status: b.status })}>Edit</Button>
                  <button type="button" aria-label={`Delete ${b.title}`} disabled={busy} onClick={() => window.confirm(`Remove “${b.title}”? A bundle that has sold is taken off sale instead.`) && void run(() => api.studioDeleteBundle(b.id), "Bundle removed.")} className="rounded-lg p-2 text-ink-500 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "plans" && settings.subscriptionsEnabled && (
        <section className="space-y-4">
          {plan ? (
            <form onSubmit={savePlan} className={`${cardCls} space-y-3 p-4`}>
              <h3 className="text-lg font-semibold text-ink">{plan.id ? "Edit pass" : "New school pass"}</h3>
              <Field label="Title" htmlFor={`${fid}-pt`}><input id={`${fid}-pt`} required maxLength={120} value={plan.title} onChange={(e) => setPlan({ ...plan, title: e.target.value })} className={controlCls} placeholder="Monthly pass" /></Field>
              <Field label="What it includes (optional)" htmlFor={`${fid}-ps`}><textarea id={`${fid}-ps`} rows={2} maxLength={2000} value={plan.summary} onChange={(e) => setPlan({ ...plan, summary: e.target.value })} className={controlCls} /></Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Price (UGX)" htmlFor={`${fid}-pp`}><input id={`${fid}-pp`} required type="number" min={0} inputMode="numeric" value={plan.price} onChange={(e) => setPlan({ ...plan, price: e.target.value })} className={controlCls} /></Field>
                <Field label={`Days it lasts (up to ${settings.maxPlanDays})`} htmlFor={`${fid}-pd`}><input id={`${fid}-pd`} required type="number" min={1} max={settings.maxPlanDays} inputMode="numeric" value={plan.days} onChange={(e) => setPlan({ ...plan, days: e.target.value })} className={controlCls} /></Field>
              </div>
              <label className="flex items-center gap-2 text-lg text-ink"><input type="checkbox" checked={plan.status === "published"} onChange={(e) => setPlan({ ...plan, status: e.target.checked ? "published" : "draft" })} className="h-4 w-4 accent-[rgb(var(--color-gold))]" /> On sale now</label>
              <div className="flex gap-2"><Button type="submit" disabled={busy}>Save pass</Button><Button variant="secondary" onClick={() => setPlan(null)}>Cancel</Button></div>
            </form>
          ) : (
            <Button onClick={() => setPlan({ id: null, title: "", summary: "", price: "0", days: "30", status: "draft" })}><Plus className="h-4 w-4" aria-hidden /> New school pass</Button>
          )}
          <p className="text-base text-ink-500">A pass opens every published course of this school, including ones you add later, until it runs out.</p>
          <ul className="space-y-2">
            {sales?.plans.map((p: StudioPlan) => (
              <li key={p.id} className={`${cardCls} flex flex-wrap items-center justify-between gap-3 p-3`}>
                <div className="min-w-0">
                  <p className="text-lg font-semibold text-ink">{p.title}</p>
                  <p className="text-base text-ink-500">{formatMoney(p.priceUgx)} · {p.days} days · {p.sold} sold</p>
                </div>
                <div className="flex gap-2">
                  <Chip tone={p.status === "published" ? "green" : "muted"}>{p.status === "published" ? "On sale" : "Draft"}</Chip>
                  <Button variant="secondary" className="!min-h-8 !px-3 !text-base" onClick={() => setPlan({ id: p.id, title: p.title, summary: p.summary, price: String(p.priceUgx), days: String(p.days), status: p.status })}>Edit</Button>
                  <button type="button" aria-label={`Delete ${p.title}`} disabled={busy} onClick={() => window.confirm(`Remove “${p.title}”? A pass that has sold is taken off sale instead.`) && void run(() => api.studioDeletePlan(p.id), "Pass removed.")} className="rounded-lg p-2 text-ink-500 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
