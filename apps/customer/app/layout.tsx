import '@peebee/shared/auth.css';
import "./account-auth.css";
import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import "./food-theme.css";
import "./pharmacy-theme.css";
import "./buy-theme.css";
import "./food-cards.css";
import "./food-subhome.css";
import "./eat-home.css";
import { AppShell } from "../components/AppShell";
import { CallOverlay } from "../components/CallOverlay";
import { InstallPrompt } from "../components/InstallPrompt";
import { OfflineBanner } from "../components/OfflineBanner";
import { PushNotifications } from "../components/PushNotifications";
import { ServiceWorkerRegister } from "../components/ServiceWorkerRegister";
import { AuthProvider } from "../lib/auth-context";
import { CallsProvider } from "../lib/calls-context";
import { LanguageProvider } from "../lib/i18n";
import { SITE_URL } from "../lib/public-share";
import { DataRefresh } from "@peebee/shared/data-refresh";

// Runs before paint so there's no flash of the wrong theme — reads the
// user's saved choice, falling back to their OS preference.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("peebee-theme"); // "light" | "dark" | "auto" | null
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
  // Absolute URLs for every page's canonical link and preview image.
  metadataBase: new URL(SITE_URL),
  title: "Peebee Customer",
  description: "Peebee Concierge — customer app",
  openGraph: {
    type: "website",
    siteName: "Peebee",
    locale: "en_UG",
    title: "Peebee: food, shopping and deliveries in Uganda",
    description: "Order food, shop from local stores and send parcels. A Peebee rider brings it to your door, paid safely in the app.",
    images: [{ url: "/icons/icon-512.png", width: 512, height: 512, alt: "Peebee" }],
  },
  twitter: { card: "summary" },
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.svg?v=logo-6", sizes: "any", type: "image/svg+xml" },
      { url: "/icons/icon-192.png?v=logo-6", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png?v=logo-6",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Peebee",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  viewportFit: "cover",
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
          <LanguageProvider>
            <CallsProvider>
              <AppShell><DataRefresh>{children}</DataRefresh></AppShell>
              <PushNotifications />
              <CallOverlay />
            </CallsProvider>
          </LanguageProvider>
        </AuthProvider>
        <InstallPrompt />
      </body>
    </html>
  );
}
