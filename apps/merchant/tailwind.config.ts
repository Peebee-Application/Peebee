import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "../../packages/shared/src/Learning*.tsx"],
  theme: {
    extend: {
      colors: {
        cream: "rgb(var(--cream, var(--color-cream)) / <alpha-value>)",
        ink: {
          DEFAULT: "rgb(var(--ink, var(--color-ink)) / <alpha-value>)",
          500: "rgb(var(--ink-muted, var(--color-ink-500)) / <alpha-value>)",
          gold: "rgb(var(--color-ink-gold, 10 10 10) / <alpha-value>)",
        },
        gold: "rgb(var(--gold, var(--color-gold)) / <alpha-value>)",
        navy: "rgb(var(--navy, var(--color-navy)) / <alpha-value>)",
        green: "rgb(var(--green, var(--color-green)) / <alpha-value>)",
        black: {
          DEFAULT: "rgb(var(--color-black, 10 10 10) / <alpha-value>)",
          700: "rgb(var(--color-black-700, 26 26 26) / <alpha-value>)",
          900: "rgb(var(--color-black-900, 10 10 10) / <alpha-value>)",
        },
      },
    },
  },
  plugins: [],
};
export default config;
