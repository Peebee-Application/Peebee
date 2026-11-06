"use client";

import { useLanguage } from "../lib/i18n";

export function LanguageSettings() {
  const { language, setLanguage } = useLanguage();

  return (
    <section className="home-card space-y-2.5">
      <h2 className="text-sm font-semibold text-ink">Language</h2>
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            { code: "en" as const, label: "English" },
            { code: "lg" as const, label: "Luganda" },
          ]
        ).map((opt) => (
          <button
            key={opt.code}
            type="button"
            onClick={() => setLanguage(opt.code)}
            aria-pressed={language === opt.code}
            className="select-card items-center text-center"
          >
            <span className="select-card__title text-sm text-ink">{opt.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
