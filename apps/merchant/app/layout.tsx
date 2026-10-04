import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { AppShell } from "../components/AppShell";
import { InstallPrompt } from "../components/InstallPrompt";
import { ServiceWorkerRegister } from "../components/ServiceWorkerRegister";
import { AuthProvider } from "../lib/auth-context";
import "./globals.css";

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
  title: "Peebee Merchant",
  description: "Accept Peebee payments and manage settlements",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/favicon-32.png?v=opaque-2", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png?v=opaque-2", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png?v=opaque-2",
  },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Peebee Merchant" },
};
export const viewport: Viewport = { themeColor: "#153A75", viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh bg-cream text-ink">
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        <ServiceWorkerRegister />
        <AuthProvider><AppShell>{children}</AppShell></AuthProvider>
        <InstallPrompt />
      </body>
    </html>
  );
}
