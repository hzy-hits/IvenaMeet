import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Discord-like Core Backgrounds
        bg: {
          dark: "#1E1F22", // App Background
          panel: "#2B2D31", // Sidebar/Cards Background
          light: "#313338", // Hover/Input Background
        },
        // Accents
        accent: {
          DEFAULT: "#5865F2", // Discord Blurple
          hover: "#4752C4",
          neon: "#00f0ff", // Sci-fi pop
        },
        // Status Colors
        ok: "#23a559", // Online / Success
        warn: "#FEE75C",
        error: "#DA373C",
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
