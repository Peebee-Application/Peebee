"use client";

import { Bell, Settings, User, Wallet, type LucideIcon } from "lucide-react";
import { useHeaderDrawer, type HeaderDrawerSection } from "../../lib/header-drawer";
import { drawerFont } from "./drawer-font";
import { NotificationsExpanded, ProfileExpanded, SettingsExpanded, WalletExpanded } from "./expanded";
import "./header-drawer.css";
import { NotificationsPreview, ProfilePreview, SettingsPreview, WalletPreview } from "./previews";

const TABS: { id: HeaderDrawerSection; label: string; Icon: LucideIcon }[] = [
  { id: "profile", label: "Profile", Icon: User },
  { id: "wallet", label: "Wallet", Icon: Wallet },
  { id: "notifications", label: "Notifications", Icon: Bell },
  { id: "settings", label: "Settings", Icon: Settings },
];

function badgeText(n: number) {
  return n > 99 ? "99+" : String(n);
}

export function HeaderDrawerCard({
  open,
  notificationCount,
}: {
  open: boolean;
  notificationCount: number;
}) {
  const drawer = useHeaderDrawer();
  const section = drawer.section;
  const preview = drawer.mode !== "section";

  function onTab(next: HeaderDrawerSection) {
    if (drawer.mode === "section") {
      drawer.openSection(next);
      return;
    }
    drawer.selectTab(next);
  }

  return (
    <div
      id="header-menu"
      className={`customer-drawer ${drawerFont.className} ${open ? (preview ? "is-menu" : "is-section") : ""}`}
      inert={!open}
      aria-hidden={!open}
    >
      <div className="customer-drawer-tabs" role="tablist" aria-label="Account menu">
        {TABS.map((tab) => {
          const on = section === tab.id;
          const badge = tab.id === "notifications" ? notificationCount : 0;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={on}
              aria-label={badge > 0 ? `${tab.label}, ${badge} new` : tab.label}
              className={`customer-drawer-tab ${on ? "is-on" : ""}`}
              onClick={() => onTab(tab.id)}
            >
              <span className="customer-drawer-tab-icon">
                <tab.Icon size={20} strokeWidth={1.9} aria-hidden />
                {badge > 0 && (
                  <span aria-hidden className="customer-drawer-badge">
                    {badgeText(badge)}
                  </span>
                )}
              </span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
      {preview ? (
        <div className="customer-drawer-preview" role="tabpanel">
          {section === "profile" && <ProfilePreview onOpen={() => drawer.openSection("profile")} />}
          {section === "wallet" && <WalletPreview onOpen={() => drawer.openSection("wallet")} />}
          {section === "notifications" && (
            <NotificationsPreview onOpen={() => drawer.openSection("notifications")} />
          )}
          {section === "settings" && <SettingsPreview onOpen={() => drawer.openSection("settings")} />}
        </div>
      ) : (
        <div className="customer-drawer-body" role="tabpanel">
          {section === "profile" && <ProfileExpanded />}
          {section === "wallet" && <WalletExpanded />}
          {section === "notifications" && <NotificationsExpanded />}
          {section === "settings" && <SettingsExpanded />}
        </div>
      )}
    </div>
  );
}
