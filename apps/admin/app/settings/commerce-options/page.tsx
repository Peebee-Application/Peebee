"use client";

import { useState } from "react";
import { hasPermission } from "@peebee/shared";
import { OptionSettingsPanel } from "../../../components/OptionSettingsPanel";
import { PageHeader } from "../../../components/SettingsPageShell";
import { useAuth } from "../../../lib/auth-context";
import { LearningCreatorPermissions } from "../../../components/LearningCreatorPermissions";

const TABS = [
  { id: "storefront", label: "Web storefront" },
  { id: "portal", label: "Merchant sign-up site" },
  { id: "plans", label: "Merchant plans" },
  { id: "digital", label: "Digital products" },
  { id: "lms", label: "Courses & Learn" },
  { id: "services", label: "Services" },
  { id: "platform", label: "Limits & team roles" },
] as const;

export default function CommerceOptionsPage() {
  const { user } = useAuth();
  const canManage = hasPermission(user?.adminRole ?? null, "settings.manage");
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("storefront");

  return (
    <div className="admin-page space-y-5 px-4 pb-6 pt-4 lg:px-8 lg:pt-2">
      <PageHeader
        title="Store, digital & services options"
        description="Every way the web store, digital products, courses and services can work. The recommended choice is the default; the others are here to switch on. Choices that are not built yet are locked."
      />
      <div role="tablist" aria-label="Module" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`min-h-10 rounded-full border px-4 text-xs font-bold transition ${tab === t.id ? "border-gold bg-gold/15 text-ink" : "border-ink/10 text-ink-600"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <OptionSettingsPanel module={tab} canManage={canManage} />
      {tab === "lms" && <LearningCreatorPermissions canManage={canManage} />}
    </div>
  );
}
