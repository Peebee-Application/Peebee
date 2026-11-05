"use client";

import { ClipboardList, ExternalLink, Plus } from "lucide-react";
import { usePathname } from "next/navigation";

export function BottomNav({
  activeTab = "new",
  onTabChange,
  isSuperAdmin = false,
}: {
  activeTab?: "new" | "records";
  onTabChange?: (tab: "new" | "records") => void;
  isSuperAdmin?: boolean;
}) {
  const pathname = usePathname();

  if (pathname !== "/") return null;

  return (
    <nav
      aria-label="Bottom Navigation"
      className="customer-nav fixed inset-x-0 bottom-3 z-40 px-3 pointer-events-none pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex max-w-sm items-center justify-center">
        <ul className="customer-nav-capsule pointer-events-auto flex w-full items-stretch justify-around rounded-[24px] p-1.5 gap-1">
          <li className="flex-1">
            <button
              type="button"
              onClick={() => onTabChange?.("new")}
              aria-current={activeTab === "new" ? "page" : undefined}
              className={`customer-nav-item relative flex h-[62px] w-full flex-col items-center justify-center gap-1 rounded-[18px] px-1 py-1 text-xs font-bold transition-all duration-200 active:scale-95 ${
                activeTab === "new" ? "is-active" : ""
              }`}
            >
              <Plus className="h-6 w-6" strokeWidth={activeTab === "new" ? 2.4 : 1.8} aria-hidden />
              <span className="leading-none">Register</span>
              {activeTab === "new" && (
                <span
                  className="customer-nav-indicator absolute bottom-1.5 h-1 w-3.5 rounded-full"
                  aria-hidden
                />
              )}
            </button>
          </li>
          <li className="flex-1">
            <button
              type="button"
              onClick={() => onTabChange?.("records")}
              aria-current={activeTab === "records" ? "page" : undefined}
              className={`customer-nav-item relative flex h-[62px] w-full flex-col items-center justify-center gap-1 rounded-[18px] px-1 py-1 text-xs font-bold transition-all duration-200 active:scale-95 ${
                activeTab === "records" ? "is-active" : ""
              }`}
            >
              <ClipboardList className="h-6 w-6" strokeWidth={activeTab === "records" ? 2.4 : 1.8} aria-hidden />
              <span className="leading-none">Records</span>
              {activeTab === "records" && (
                <span
                  className="customer-nav-indicator absolute bottom-1.5 h-1 w-3.5 rounded-full"
                  aria-hidden
                />
              )}
            </button>
          </li>
          {isSuperAdmin && (
            <li className="flex-1">
              <a
                href="https://admin.peebee.online/onboarding"
                target="_blank"
                rel="noreferrer"
                className="customer-nav-item relative flex h-[62px] w-full flex-col items-center justify-center gap-1 rounded-[18px] px-1 py-1 text-xs font-bold transition-all duration-200 active:scale-95"
              >
                <ExternalLink className="h-6 w-6" strokeWidth={1.8} aria-hidden />
                <span className="leading-none">Admin</span>
              </a>
            </li>
          )}
        </ul>
      </div>
    </nav>
  );
}
