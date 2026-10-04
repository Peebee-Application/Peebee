import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { AppShell } from "../components/AppShell";
import { InstallPrompt } from "../components/InstallPrompt";
import { OfflineBanner } from "../components/OfflineBanner";
import { ServiceWorkerRegister } from "../components/ServiceWorkerRegister";
import { AuthProvider } from "../lib/auth-context";

// Runs before paint so there's no flash of the wrong theme — reads the
// user's saved choice, falling back to their OS preference.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("peebee-theme");
    var theme = stored === "light" || stored === "dark"
      ? stored
      : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {}
})();
`;

export const metadata: Metadata = {
  title: "Peebee Admin",
  description: "Peebee Concierge — admin dashboard",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icons/favicon-32.png?v=logos-3", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png?v=logos-3", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png?v=logos-3",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Peebee Admin",
  },
};

export const viewport: Viewport = {
  themeColor: "#153A75",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh bg-cream text-ink">
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        <ServiceWorkerRegister />
        <OfflineBanner />
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
        <InstallPrompt />
      </body>
    </html>
  );
}
