import localFont from "next/font/local";

// The Learn screens have their own type: a display face for headings, a clean body face and a mono face for codes.
// Each screen sets the variables on its root, so nothing outside Learn changes.
// Files are the Latin subsets previously fetched from Google Fonts at build time.
// Variable families are one woff2; each used weight is its own face so in-between weights still snap.
export const display = localFont({
  src: [
    { path: "../../lib/fonts/bricolage-grotesque/bricolage-grotesque-latin.woff2", weight: "500", style: "normal" },
    { path: "../../lib/fonts/bricolage-grotesque/bricolage-grotesque-latin.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-lh-display",
  display: "swap",
});
export const bodyFont = localFont({
  src: [
    { path: "../../lib/fonts/dm-sans/dm-sans-latin.woff2", weight: "400", style: "normal" },
    { path: "../../lib/fonts/dm-sans/dm-sans-latin.woff2", weight: "500", style: "normal" },
    { path: "../../lib/fonts/dm-sans/dm-sans-latin.woff2", weight: "600", style: "normal" },
    { path: "../../lib/fonts/dm-sans/dm-sans-latin.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-lh-body",
  display: "swap",
});
export const monoFont = localFont({
  src: "../../lib/fonts/dm-mono/dm-mono-latin-500.woff2",
  weight: "500",
  style: "normal",
  variable: "--font-lh-mono",
  display: "swap",
});
