"use client";

import type { LearnerCertificate } from "@peebee/shared";
import { Award, Printer } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../../lib/api";
import { ErrorNote, LearnScreen, ScreenHeader, Skeleton, displayFont, monoCls, primaryBtn } from "../../ui";

export default function CertificatePage() {
  const { id } = useParams<{ id: string }>();
  const [cert, setCert] = useState<LearnerCertificate | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.learnCertificate(id).then((r) => setCert(r.certificate)).catch((err) => setError(errorMessage(err)));
  }, [id]);

  return (
    <LearnScreen>
      <div className="print:hidden">
        <ScreenHeader back={{ href: "/learn/certificates", label: "Certificates" }} label="Peebee Learn" title="Your certificate" />
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {!cert && !error && <Skeleton className="h-96" />}
      {cert && (
        <>
          <article className="relative overflow-hidden rounded-[28px] border-2 border-gold/60 bg-[rgb(var(--surface-card))] p-1.5 shadow-[0_24px_60px_-30px_rgb(var(--color-gold)/0.7)] print:shadow-none" aria-label="Certificate">
            <div className="relative space-y-4 overflow-hidden rounded-[22px] border border-gold/30 bg-[linear-gradient(160deg,rgb(var(--color-gold)/0.12),transparent_55%)] px-6 py-9 text-center">
              <span className="pointer-events-none absolute -right-14 -top-14 h-44 w-44 rounded-full bg-[radial-gradient(circle,rgb(var(--color-gold)/0.45),transparent_68%)]" aria-hidden />
              <span className="pointer-events-none absolute -bottom-16 -left-14 h-44 w-44 rounded-full bg-[radial-gradient(circle,rgb(var(--color-green)/0.25),transparent_68%)]" aria-hidden />
              <span className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gold/20 text-gold ring-1 ring-gold/40">
                <Award className="h-7 w-7" aria-hidden />
              </span>
              <p className="relative text-[11px] font-bold uppercase tracking-[0.3em] text-gold">Certificate of completion</p>
              <p className="relative text-sm text-ink-500">This certifies that</p>
              <h1 className={`${displayFont} relative text-[32px] font-bold leading-tight tracking-[-0.02em] text-ink`}>{cert.learnerName}</h1>
              <p className="relative text-sm text-ink-500">has completed</p>
              <h2 className={`${displayFont} relative text-2xl font-semibold leading-snug text-ink`}>{cert.courseTitle}</h2>
              <p className="relative text-sm text-ink-500">{cert.schoolName}</p>
              {cert.scorePercent !== null && <p className="relative inline-block rounded-full bg-gold/15 px-3 py-1 text-sm font-semibold text-ink">Average score {cert.scorePercent}%</p>}
              <p className="relative border-t border-gold/30 pt-4 text-xs text-ink-500">
                Issued {new Date(cert.issuedAt.replace(" ", "T") + "Z").toLocaleDateString("en-UG", { day: "numeric", month: "long", year: "numeric" })} · Code <span className={`${monoCls} font-medium tracking-wider text-ink`}>{cert.code}</span>
              </p>
            </div>
          </article>
          <button type="button" onClick={() => window.print()} className={`${primaryBtn} w-full print:hidden`}>
            <Printer className="h-4 w-4" aria-hidden /> Print or save as PDF
          </button>
        </>
      )}
    </LearnScreen>
  );
}
