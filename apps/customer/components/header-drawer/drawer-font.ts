import localFont from "next/font/local";

/** Roboto, as specified for the v6 drawer mockups. Scoped to the drawer only. */
export const drawerFont = localFont({
  src: "./fonts/Roboto-Variable.ttf",
  weight: "100 900",
  display: "swap",
  variable: "--customer-drawer-font",
});
