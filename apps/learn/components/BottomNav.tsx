"use client";

import { GraduationCap, Home, MessageSquare, UserRound, Video } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { filterByModule, useModules } from "../lib/modules";

/** Whether any student has written and is waiting for a reply. Quiet when messages are off or not ready. */
function useUnreadMessages(): boolean {
  const [unread, setUnread] = useState(false);
  useEffect(() => {
    let stopped = false;
    const check = () => {
      if (document.hidden) return;
      api
        .studioSchoolChats()
        .then((res) => { if (!stopped) setUnread(res.threads.some((t) => t.unread)); })
        .catch(() => { if (!stopped) setUnread(false); });
    };
    check();
    const timer = window.setInterval(check, 20000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, []);
  return unread;
}

export function BottomNav() {
  const pathname = usePathname();
  const moduleOn = useModules();
  const unread = useUnreadMessages();

  const tabs = filterByModule([
    { href: "/", label: "Home", icon: Home },
    { href: "/schools", label: "Schools", icon: GraduationCap },
    { href: "/classroom", label: "Live", icon: Video, module: "learn.live" },
    { href: "/chat", label: "Chat", icon: MessageSquare },
    { href: "/account", label: "Account", icon: UserRound },
  ], moduleOn);

  return (
    <nav aria-label="Primary navigation" className="customer-nav fixed inset-x-0 bottom-3 z-40 px-3 pointer-events-none pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-lg items-center justify-center">
        <ul className="customer-nav-capsule pointer-events-auto flex w-full items-stretch justify-around gap-1 rounded-[24px] p-1.5">
          {tabs.map((tab) => {
            const owned = tab.href === "/schools" && (pathname.startsWith("/classes") || pathname.startsWith("/courses"));
            const active = tab.href === "/" ? pathname === "/" : owned || pathname.startsWith(tab.href);
            const Icon = tab.icon;
            return (
              <li key={tab.href} className="flex-1">
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={`customer-nav-item relative flex h-16 flex-col items-center justify-center gap-1 rounded-[18px] px-1 py-1 text-xs font-bold transition-all duration-200 active:scale-95 ${active ? "is-active" : ""}`}
                >
                  <Icon className="h-6 w-6" strokeWidth={active ? 2.4 : 1.8} aria-hidden />
                  {tab.href === "/chat" && unread && <span className="absolute right-[28%] top-2.5 h-2.5 w-2.5 rounded-full bg-gold ring-2 ring-[rgb(var(--surface-card))]" aria-label="New messages" />}
                  <span className="leading-none">{tab.label}</span>
                  {active && <span className="customer-nav-indicator absolute bottom-1.5 h-1 w-3.5 rounded-full" aria-hidden />}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
