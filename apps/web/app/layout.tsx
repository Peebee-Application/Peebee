import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Shell } from "../components/Shell";
import { WebModulesProvider } from "../lib/web-modules";
import "./globals.css";
import "./desktop.css";

const sans = localFont({
  src: "../fonts/inter/inter-latin.woff2",
  weight: "100 900",
  style: "normal",
  variable: "--font-sans",
  display: "swap",
});
const display = localFont({
  src: [
    { path: "../fonts/instrument-serif/instrument-serif-latin-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/instrument-serif/instrument-serif-latin-400-italic.woff2", weight: "400", style: "italic" },
  ],
  variable: "--font-display",
  display: "swap",
  adjustFontFallback: "Times New Roman",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://peebee.online"),
  title: { default: "Peebee: ride, buy, eat, learn, work", template: "%s · Peebee" },
  description: "One account for rides, shopping, food, learning and home services in Uganda. Pay when the work is done.",
  icons: { icon: [{ url: "/favicon.svg", type: "image/svg+xml" }, { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" }], apple: "/icons/apple-touch-icon.png" },
  manifest: "/manifest.webmanifest",
  openGraph: { title: "Peebee", description: "Ride, Buy, Eat, Learn, Work. One account, paid when the work is done.", images: ["/photos/hero-ride.webp"], siteName: "Peebee" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf7f2" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1917" },
  ],
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

// Runs before paint so the theme never flashes. Same rule as the old site: saved choice, else light 06:00–19:00.
const themeInit = `try{var m=localStorage.getItem("peebee-theme");var h=new Date().getHours();var t=m==="light"||m==="dark"?m:(h>=6&&h<19?"light":"dark");document.documentElement.setAttribute("data-theme",t)}catch(e){document.documentElement.setAttribute("data-theme","light")}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" className={`${sans.variable} ${display.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>
        <WebModulesProvider><Shell>{children}</Shell></WebModulesProvider>
      </body>
    </html>
  );
}
