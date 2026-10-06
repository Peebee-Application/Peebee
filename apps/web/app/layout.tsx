import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("peebee-theme");
    var theme;
    if (stored === "light" || stored === "dark") {
      theme = stored;
    } else {
      var hour = new Date().getHours();
      theme = hour >= 6 && hour < 19 ? "light" : "dark";
    }
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {}
})();
`;

export const metadata: Metadata = {
  title: "Peebee — Uganda's delivery & errands platform",
  description: "Rides, food, shopping, and parcels — one app, verified riders. Fast, reliable, trusted.",
  icons: {
    icon: [
      { url: "/favicon.svg?v=logo-6", sizes: "any", type: "image/svg+xml" },
      { url: "/icons/icon-192.png?v=logo-6", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png?v=logo-6",
  },
};

export const viewport: Viewport = {
  themeColor: "#153A75",
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh bg-cream text-ink">
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        {children}
      </body>
    </html>
  );
}
