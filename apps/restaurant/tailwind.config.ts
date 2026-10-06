import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: [
    "../../packages/shared/src/FoodCover.tsx",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        cream: {
          DEFAULT: "rgb(var(--color-cream) / <alpha-value>)",
          50: "rgb(var(--color-cream-50) / <alpha-value>)",
          100: "rgb(var(--color-cream-100) / <alpha-value>)",
        },
        gold: {
          DEFAULT: "rgb(var(--color-gold) / <alpha-value>)",
          400: "rgb(var(--color-gold-400) / <alpha-value>)",
          500: "rgb(var(--color-gold-500) / <alpha-value>)",
        },
        ink: {
          DEFAULT: "rgb(var(--color-ink) / <alpha-value>)",
          500: "rgb(var(--color-ink-500) / <alpha-value>)",
          900: "rgb(var(--color-ink-900) / <alpha-value>)",
          gold: "rgb(var(--color-ink-gold) / <alpha-value>)",
        },
        black: {
          DEFAULT: "rgb(var(--color-black) / <alpha-value>)",
          700: "rgb(var(--color-black-700) / <alpha-value>)",
          900: "rgb(var(--color-black-900) / <alpha-value>)",
        },
        green: {
          DEFAULT: "rgb(var(--color-green) / <alpha-value>)",
          400: "rgb(var(--color-green-400) / <alpha-value>)",
          600: "rgb(var(--color-green-600) / <alpha-value>)",
        },
        // From the Peebee wordmark — used for brand chrome (header accents,
        // headings-as-brand, trust badges), kept separate from `gold`
        // which stays the one CTA/interactive accent.
        navy: {
          DEFAULT: "rgb(var(--color-navy) / <alpha-value>)",
          400: "rgb(var(--color-navy-400) / <alpha-value>)",
          700: "rgb(var(--color-navy-700) / <alpha-value>)",
        },
      },
    },
  },
  plugins: [],
};

export default config;
