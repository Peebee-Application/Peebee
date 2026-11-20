import { BookOpen } from "lucide-react";
import Link from "next/link";

export function LearnComingSoon({ title }: { title: string }) {
  return <section className="space-y-6 px-5 py-8"><p className="text-xs font-bold uppercase tracking-widest text-gold">Peebee Learn</p><h1 className="text-4xl font-extrabold tracking-tight">{title}</h1><div className="rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-8 text-center"><BookOpen className="mx-auto mb-4 h-12 w-12 text-gold" aria-hidden /><h2 className="text-2xl font-bold">Coming soon</h2><p className="mt-3 text-sm text-ink-500">A new part of your learning journey is on its way.</p></div><Link href="/learn" className="inline-flex min-h-12 items-center rounded-full bg-gold px-6 font-bold text-ink-gold">Discover Learn</Link></section>;
}
