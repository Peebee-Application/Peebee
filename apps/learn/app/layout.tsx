import "@peebee/shared/auth.css";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "../components/AppShell";
import { CallOverlay } from "../components/CallOverlay";
import { AuthProvider } from "../lib/auth-context";
import { CallsProvider } from "../lib/calls-context";
import { ServiceWorkerRegister } from "../components/ServiceWorkerRegister";
import { DataRefresh } from "@peebee/shared/data-refresh";

const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("peebee-theme");
    var mode = stored === "light" || stored === "dark" || stored === "auto" ? stored : "auto";
    var theme;
    if (mode === "auto") {
      var hour = new Date().getHours();
      theme = hour >= 6 && hour < 19 ? "light" : "dark";
    } else {
      theme = mode;
    }
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {}
})();
`;

export const metadata: Metadata = {
  title: "Peebee Learn — Educator Studio",
  description: "Create a school, run classes and masterclasses, and publish courses and lessons for every stage of learning, from kindergarten to university to everyday skills",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.svg?v=logo-6", sizes: "any", type: "image/svg+xml" },
      { url: "/icons/icon-192.png?v=logo-6", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png?v=logo-6",
  },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Peebee Learn" },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: any }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body><ServiceWorkerRegister />
        <AuthProvider>
          <CallsProvider>
            <AppShell><DataRefresh>{children}</DataRefresh></AppShell>
            <CallOverlay />
          </CallsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
