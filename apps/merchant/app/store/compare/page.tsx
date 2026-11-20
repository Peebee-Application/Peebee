"use client";

import Link from "next/link";
import { ArrowLeft, Briefcase, Check, Crown, Download, Globe, Minus, Package, Store, Truck } from "lucide-react";
import { useStoreSales, salesPrice, type ComparisonRow } from "../../../lib/store-sales";
import { SalesLoading, UpgradeAction } from "../../../components/store/StoreSalesUI";
import { StoreGlow, card } from "../../../components/store/StoreUI";

function Availability({ value, label }: { value: ComparisonRow["pro"]; label: string }) {
  if (typeof value === "string") return <span className="block text-center text-xs font-bold text-ink sm:text-sm">{value}</span>;
  return <span className="flex justify-center"><span className="sr-only">{label}: {value ? "Included" : "Not included"}</span>{value ? <Check className="h-5 w-5 text-gold sm:h-6 sm:w-6" strokeWidth={3} aria-hidden /> : <Minus className="h-4 w-4 text-ink-500" aria-hidden />}</span>;
}
export default function StoreComparisonPage() {
  const { data, error, retry } = useStoreSales();
  const icons = [Store, Globe, Briefcase, Truck];
  return <div className="relative mx-auto max-w-3xl space-y-5 px-4 pb-10 pt-5">
    <StoreGlow />
    <div className="relative space-y-5">
      <Link href="/store" className="inline-flex min-h-11 items-center gap-2 rounded-full bg-gold/10 px-4 text-base font-black text-ink"><ArrowLeft className="h-5 w-5" aria-hidden />Store</Link>
      <header><h1 className="text-[34px] font-black leading-tight tracking-tight text-ink sm:text-[44px]">Find the right fit.</h1><p className="mt-2 text-lg text-ink-500">Compare Pro and Elite, feature by feature.</p></header>
      {!data ? <SalesLoading error={error} retry={retry} /> : <>
        <div className="grid grid-cols-2 gap-3">
          {(["pro", "elite"] as const).map(tier => { const Icon = tier === "pro" ? Package : Crown; return <section key={tier} className={`${card} space-y-2 p-4 ${tier === "pro" ? "!border-gold !bg-black !text-white" : "text-ink"}`}>
            <span className="grid h-12 w-12 place-items-center rounded-[16px] bg-cream text-gold"><Icon className="h-8 w-8" aria-hidden /></span>
            <h2 className="text-[28px] font-black">{tier === "pro" ? "Pro" : "Elite"}</h2>
            <p className={`min-h-12 text-sm leading-snug ${tier === "pro" ? "text-white/80" : "text-ink-500"}`}>{tier === "pro" ? "Display & go live." : "Everything in Pro, and more."}</p>
            <p className="inline-block rounded-full bg-cream px-3 py-1 text-xs font-black text-ink-gold">{data.plans[tier].enabled ? salesPrice(data.plans[tier].monthly) : "Currently unavailable"}</p>
          </section>; })}
        </div>
        <div className={`${card} overflow-hidden`}>
          <table className="w-full table-fixed border-collapse text-left" data-testid="full-plan-comparison">
            <caption className="sr-only">Complete Pro and Elite plan comparison. Availability and product limits reflect the current Peebee offering.</caption>
            <colgroup><col className="w-[64%]" /><col className="w-[18%]" /><col className="w-[18%]" /></colgroup>
            <thead><tr className="bg-gold/10"><th scope="col" className="px-4 py-4 text-base font-black text-ink">Tool</th><th scope="col" className="px-1 py-4 text-center text-base font-black text-ink">Pro</th><th scope="col" className="px-1 py-4 text-center text-base font-black text-ink">Elite</th></tr></thead>
            {data.groups.map((group, index) => { const Icon = icons[index] ?? Download; return <tbody key={group.title}>
              <tr><th colSpan={3} scope="colgroup" className="px-3 pb-1 pt-4"><span className="flex items-center gap-3 rounded-[18px] bg-gold/10 px-3 py-3 text-[18px] font-black text-ink"><Icon className="h-6 w-6 shrink-0 text-gold" aria-hidden />{group.title}</span></th></tr>
              {group.rows.map(row => <tr key={row.key} className="border-b border-[var(--border-faint)] last:border-0"><th scope="row" className="px-4 py-3 text-[14px] font-semibold leading-snug text-ink sm:px-6 sm:text-base">{row.label}{row.note && <span className="mt-1 block text-[11px] font-normal leading-snug text-ink-500 sm:text-xs">{row.note}</span>}</th><td className="px-1 py-3"><Availability value={row.pro} label={`Pro ${row.label}`} /></td><td className="px-1 py-3"><Availability value={row.elite} label={`Elite ${row.label}`} /></td></tr>)}
            </tbody>; })}
          </table>
        </div>
        <div className="grid grid-cols-2 gap-3"><UpgradeAction data={data} tier="pro" compact /><UpgradeAction data={data} tier="elite" compact dark /></div>
        <p className="text-center text-sm text-ink-500">{data.canUpgrade ? "Review your plan before confirming. Charges, where applicable, are shown before you pay." : "The business owner confirms plan changes."}</p>
      </>}
    </div>
  </div>;
}
