import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          dark: "rgb(var(--bg-dark) / <alpha-value>)",
          panel: "rgb(var(--bg-panel) / <alpha-value>)",
          light: "rgb(var(--bg-light) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          hover: "rgb(var(--accent-hover) / <alpha-value>)",
          neon: "rgb(var(--accent-neon) / <alpha-value>)",
        },
        ok: "rgb(var(--ok) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        error: "rgb(var(--error) / <alpha-value>)",
      },
      fontFamily: {
        space: ["Space Grotesk", "sans-serif"],
        mono: ["IBM Plex Mono", "monospace"],
      },
      boxShadow: {
        'glow': '0 0 15px -3px rgba(88, 101, 242, 0.4), 0 0 6px -2px rgba(88, 101, 242, 0.2)',
        'glow-neon': '0 0 15px -3px rgba(0, 240, 255, 0.5), 0 0 6px -2px rgba(0, 240, 255, 0.3)',
      }
    },
  },
  plugins: [],
} satisfies Config;
