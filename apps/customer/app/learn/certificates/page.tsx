"use client";

import type { LearnerBadge, LearnerCertificate } from "@peebee/shared";
import { Award, ChevronRight, GraduationCap } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../lib/api";
import { Empty, ErrorNote, LearnScreen, Pill, ScreenHeader, SectionTitle, Skeleton, card, cardLink, displayFont } from "../ui";

export default function CertificatesPage() {
  const [certs, setCerts] = useState<LearnerCertificate[] | null>(null);
  const [badges, setBadges] = useState<LearnerBadge[]>([]);
  const [badgesOn, setBadgesOn] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.learnCertificates().then((r) => setCerts(r.certificates)).catch((err) => setError(errorMessage(err)));
    api.learnBadges().then((r) => { setBadges(r.badges); setBadgesOn(r.enabled); }).catch(() => undefined);
  }, []);

  const earned = badges.filter((b) => b.awardedAt).length;

  return (
    <LearnScreen>
      <ScreenHeader back={{ href: "/learn/my", label: "My class" }} label="Peebee Learn" title="Certificates and badges" subtitle="Everything you have earned, ready to print or share." />
      {error && <ErrorNote>{error}</ErrorNote>}

      <section aria-labelledby="certs-h" className="space-y-3">
        <SectionTitle id="certs-h" icon={GraduationCap}>
          Certificates
        </SectionTitle>
        {certs === null ? (
          <Skeleton className="h-20" />
        ) : certs.length === 0 ? (
          <Empty icon={GraduationCap}>Finish every item of a class and your certificate appears here.</Empty>
        ) : (
          <ul className="space-y-2.5">
            {certs.map((c) => (
              <li key={c.id}>
                <Link href={`/learn/certificates/${c.id}`} className={`${cardLink} relative flex items-center gap-3 overflow-hidden p-4`}>
                  <span className="pointer-events-none absolute -left-6 -top-8 h-24 w-24 rounded-full bg-[radial-gradient(circle,rgb(var(--color-gold)/0.4),transparent_70%)]" aria-hidden />
                  <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(145deg,rgb(var(--color-gold)/0.4),rgb(var(--color-gold)/0.12))] text-gold ring-1 ring-gold/30">
                    <GraduationCap className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="relative min-w-0 flex-1">
                    <span className={`${displayFont} block truncate text-[15px] font-semibold text-ink`}>{c.courseTitle}</span>
                    <span className="block truncate text-xs text-ink-500">{c.schoolName} · {new Date(c.issuedAt.replace(" ", "T") + "Z").toLocaleDateString("en-UG", { day: "numeric", month: "short", year: "numeric" })}</span>
                  </span>
                  <ChevronRight className="relative h-4 w-4 text-ink-500" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {badgesOn && (
        <section aria-labelledby="badges-h" className="space-y-3">
          <SectionTitle id="badges-h" icon={Award} action={badges.length > 0 ? <Pill tone="muted">{earned} of {badges.length}</Pill> : undefined}>
            Badges
          </SectionTitle>
          <ul className="grid grid-cols-2 gap-2.5">
            {badges.map((b) => (
              <li key={b.key} className={`${card} relative space-y-1 overflow-hidden p-4 text-center ${b.awardedAt ? "" : "opacity-55"}`}>
                {b.awardedAt && <span className="pointer-events-none absolute left-1/2 top-0 h-20 w-20 -translate-x-1/2 -translate-y-8 rounded-full bg-gold/30 blur-xl" aria-hidden />}
                <span className={`relative block text-3xl ${b.awardedAt ? "" : "grayscale"}`} aria-hidden>{b.icon}</span>
                <span className={`${displayFont} relative block text-sm font-bold text-ink`}>{b.title}</span>
                <span className="relative block text-xs text-ink-500">{b.awardedAt ? "Earned" : b.description}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </LearnScreen>
  );
}
