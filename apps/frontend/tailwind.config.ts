import type { Config } from "tailwindcss";

export default {
    content: ["./index.html", "./src/**/*.{ts,tsx}"],
    theme: {
        extend: {
            colors: {
                /* ── Surfaces ── */
                canvas: "rgb(var(--canvas) / <alpha-value>)",
                parchment: "rgb(var(--parchment) / <alpha-value>)",
                rail: "rgb(var(--rail) / <alpha-value>)",

                /* ── Text ── */
                ink: "rgb(var(--ink) / <alpha-value>)",

                /* ── Accents ── */
                gold: "rgb(var(--gold) / <alpha-value>)",
                indigo: "rgb(var(--indigo) / <alpha-value>)",
                coral: "rgb(var(--coral) / <alpha-value>)",
                teal: "rgb(var(--teal) / <alpha-value>)",

                /* ── Semantic ── */
                ok: "rgb(var(--ok) / <alpha-value>)",
                warn: "rgb(var(--warn) / <alpha-value>)",
                error: "rgb(var(--error) / <alpha-value>)",

                /* ── Legacy compatibility aliases ── */
                bg: {
                    dark: "rgb(var(--canvas) / <alpha-value>)",
                    panel: "rgb(var(--parchment) / <alpha-value>)",
                    light: "rgb(var(--rail) / <alpha-value>)",
                },
                accent: {
                    DEFAULT: "rgb(var(--gold) / <alpha-value>)",
                    hover: "rgb(var(--gold) / <alpha-value>)",
                    neon: "rgb(var(--gold) / <alpha-value>)",
                },
                card: "rgb(var(--parchment) / <alpha-value>)",
            },
            fontFamily: {
                display: ["Playfair Display", "Georgia", "serif"],
                body: ["Lora", "Georgia", "serif"],
                mono: ["IBM Plex Mono", "monospace"],
                /* Legacy alias */
                space: ["Lora", "Georgia", "serif"],
            },
            borderRadius: {
                panel: "16px",
                chip: "11px",
            },
            boxShadow: {
                mucha: "var(--shadow-mucha)",
                "gold-glow": "var(--shadow-gold-glow)",
            },
            transitionTimingFunction: {
                mucha: "cubic-bezier(.2,.8,.2,1)",
            },
            keyframes: {
                "halo-breathe": {
                    "0%, 100%": {
                        boxShadow: "0 0 0 2px rgb(var(--gold) / 0.20), 0 0 12px rgb(var(--gold) / 0.08)",
                    },
                    "50%": {
                        boxShadow: "0 0 0 3px rgb(var(--gold) / 0.35), 0 0 18px rgb(var(--gold) / 0.16)",
                    },
                },
            },
            animation: {
                "halo-breathe": "halo-breathe 2s cubic-bezier(.2,.8,.2,1) infinite",
            },
        },
    },
    plugins: [],
} satisfies Config;
