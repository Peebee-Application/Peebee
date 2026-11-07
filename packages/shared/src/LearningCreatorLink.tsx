"use client";
import { useEffect, useState } from "react";
import type { learningCreatorMethods } from "./learn-creator.js";
export function LearningCreatorLink({
  api,
  href,
  label = "Create a course or learning path",
}: {
  api: ReturnType<typeof learningCreatorMethods>;
  href: string;
  label?: string;
}) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    api
      .learningCreatorConfig()
      .then((c) => {
        if (active) setEnabled(c.enabled && c.ready);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api]);
  return enabled ? (
    <span className="flex flex-wrap items-center gap-3">
      <a
        href={href}
        className="inline-flex min-h-11 items-center rounded-xl border border-[var(--border-faint)] bg-gold px-4 py-2 text-sm font-semibold text-ink-gold"
      >
        {label}
      </a>
      {href === "/learn/create" && (
        <a
          href="/learn/messages"
          className="inline-flex min-h-11 items-center text-sm font-semibold text-gold underline"
        >
          Learn messages
        </a>
      )}
    </span>
  ) : null;
}
