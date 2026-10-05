import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cream: "rgb(var(--cream) / <alpha-value>)",
        ink: { DEFAULT: "rgb(var(--ink) / <alpha-value>)", 500: "rgb(var(--ink-muted) / <alpha-value>)", gold: "#101828" },
        gold: "rgb(var(--gold) / <alpha-value>)",
        navy: "rgb(var(--navy) / <alpha-value>)",
        green: "rgb(var(--green) / <alpha-value>)",
      },
    },
  },
  plugins: [],
};
export default config;
