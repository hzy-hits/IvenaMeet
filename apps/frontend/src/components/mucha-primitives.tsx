/**
 * Mucha UI Engine — Decorative Primitives
 *
 * Four reusable decorative components that encapsulate ALL ornamental
 * styling. Business components must ONLY use these primitives for
 * decoration — no ad-hoc ornamental classes elsewhere.
 *
 * All decorative layers use aria-hidden="true".
 */
import type { ReactNode } from "react";

/* ─────────────────────────────────────────────
   1) PaperSurface
   Parchment background + faint grain overlay + layered shadow.
   Wraps any panel / popover / modal content.
   ───────────────────────────────────────────── */
type PaperSurfaceProps = {
    children: ReactNode;
    className?: string;
    /** Use 'canvas' for main bg, 'parchment' for cards, 'rail' for deepest */
    tone?: "canvas" | "parchment" | "rail";
    as?: "div" | "aside" | "section" | "main";
};

const TONE_BG: Record<NonNullable<PaperSurfaceProps["tone"]>, string> = {
    canvas: "bg-canvas",
    parchment: "bg-parchment",
    rail: "bg-rail",
};

export function PaperSurface({
    children,
    className = "",
    tone = "parchment",
    as: Tag = "div",
}: PaperSurfaceProps) {
    return (
        <Tag className={`paper-grain mucha-contour relative shadow-mucha ${TONE_BG[tone]} ${className}`}>
            {children}
        </Tag>
    );
}

/* ─────────────────────────────────────────────
   2.1) SVG Primitives
   ───────────────────────────────────────────── */
function MuchaCorner({ className = "", style }: { className?: string, style?: React.CSSProperties }) {
    return (
        <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            className={`pointer-events-none absolute text-ink/20 ${className}`}
            style={style}
            aria-hidden="true"
        >
            {/* Art Nouveau "Whiplash" Corner Ribbon */}
            <path
                d="M 2 2 L 6 2 C 12 2 18 8 18 14 L 18 22 M 2 2 L 2 6 C 2 12 8 18 14 18 L 22 18"
                stroke="currentColor"
                strokeWidth="0.75"
                strokeLinecap="round"
                fill="none"
            />
            {/* Corner Node */}
            <circle cx="4" cy="4" r="1.5" fill="currentColor" opacity="0.7" />
            <circle cx="8" cy="8" r="0.75" fill="currentColor" opacity="0.4" />
        </svg>
    );
}

export function MuchaArch({ children, className = "" }: { children: ReactNode, className?: string }) {
    return (
        <div className={`relative ${className}`}>
            <svg
                className="absolute inset-x-0 top-0 h-12 w-full text-ink/15 pointer-events-none"
                preserveAspectRatio="none"
                viewBox="0 0 300 48"
                aria-hidden="true"
            >
                {/* Mucha Arch - classic semi-circle + shoulder lines */}
                <path
                    d="M 0 47 L 20 47 Q 40 47 60 27 T 150 4 T 240 27 Q 260 47 300 47"
                    stroke="currentColor"
                    strokeWidth="0.75"
                    fill="none"
                />
                <circle cx="150" cy="4" r="2" fill="currentColor" opacity="0.6" />
                <circle cx="150" cy="12" r="1" fill="currentColor" opacity="0.3" />
            </svg>
            <div className="relative z-10 pt-4">
                {children}
            </div>
        </div>
    );
}

export function MuchaHalo({ className = "" }: { className?: string }) {
    return (
        <svg
            className={`pointer-events-none ${className}`}
            viewBox="0 0 200 200"
            fill="none"
            aria-hidden="true"
        >
            {/* Outer thick ring */}
            <circle cx="100" cy="100" r="90" stroke="currentColor" strokeWidth="2" opacity="0.3" />

            {/* Inner thin ring */}
            <circle cx="100" cy="100" r="82" stroke="currentColor" strokeWidth="0.5" opacity="0.6" />

            {/* Geometric star/floral pattern inside */}
            <path
                d="M 100 18 L 115 80 L 180 100 L 115 120 L 100 182 L 85 120 L 18 100 L 85 80 Z"
                stroke="currentColor"
                strokeWidth="0.5"
                fill="none"
                opacity="0.2"
            />
            <circle cx="100" cy="18" r="4" fill="currentColor" opacity="0.6" />
            <circle cx="182" cy="100" r="4" fill="currentColor" opacity="0.6" />
            <circle cx="100" cy="182" r="4" fill="currentColor" opacity="0.6" />
            <circle cx="18" cy="100" r="4" fill="currentColor" opacity="0.6" />

            {/* Intricate dots */}
            <circle cx="158" cy="42" r="1.5" fill="currentColor" opacity="0.4" />
            <circle cx="42" cy="42" r="1.5" fill="currentColor" opacity="0.4" />
            <circle cx="158" cy="158" r="1.5" fill="currentColor" opacity="0.4" />
            <circle cx="42" cy="158" r="1.5" fill="currentColor" opacity="0.4" />
        </svg>
    );
}

/* ─────────────────────────────────────────────
   2) OrnamentFrame
   Thin border with SVG whiplash corner flourishes.
   ───────────────────────────────────────────── */
type OrnamentFrameProps = {
    children: ReactNode;
    className?: string;
    /** 'soft' for panels, 'strong' for active/focus states */
    intensity?: "soft" | "strong";
};

export function OrnamentFrame({
    children,
    className = "",
    intensity = "soft",
}: OrnamentFrameProps) {
    const borderClass =
        intensity === "strong"
            ? "border border-gold/55"
            : "mucha-contour";

    return (
        <div className={`relative ${borderClass} rounded-panel ${className}`}>
            <MuchaCorner style={{ top: "-2px", left: "-2px" }} />
            <MuchaCorner style={{ top: "-2px", right: "-2px", transform: "scaleX(-1)" }} />
            <MuchaCorner style={{ bottom: "-2px", left: "-2px", transform: "scaleY(-1)" }} />
            <MuchaCorner style={{ bottom: "-2px", right: "-2px", transform: "scale(-1, -1)" }} />
            {children}
        </div>
    );
}

/* ─────────────────────────────────────────────
   3) HaloIndicator
   Soft gold glow ring for active / speaking states.
   Animated with 2s breathing; degrades via
   prefers-reduced-motion (handled in styles.css).
   ───────────────────────────────────────────── */
type HaloIndicatorProps = {
    active: boolean;
    children: ReactNode;
    className?: string;
};

export function HaloIndicator({
    active,
    children,
    className = "",
}: HaloIndicatorProps) {
    return (
        <div className={`relative ${active ? "halo-active" : ""} rounded-full ${className}`}>
            {children}
        </div>
    );
}

/* ─────────────────────────────────────────────
   4) OrnateDivider
   Fine gold-tinted horizontal rule with center ornament.
   Uses the .ornate-divider class from styles.css.
   ───────────────────────────────────────────── */
type OrnateDividerProps = {
    className?: string;
};

export function OrnateDivider({ className = "" }: OrnateDividerProps) {
    return (
        <div aria-hidden="true" className={`flex items-center justify-center my-4 opacity-40 ${className}`}>
            <svg width="120" height="12" viewBox="0 0 120 12" fill="none" className="text-ink">
                {/* Left Vine */}
                <path d="M0 6 Q 20 6 30 2 T 50 6" stroke="currentColor" strokeWidth="0.5" fill="none" />
                {/* Center Lozenge */}
                <path d="M55 6 L 60 2 L 65 6 L 60 10 Z" fill="currentColor" opacity="0.5" />
                <circle cx="60" cy="6" r="1" fill="currentColor" />
                {/* Right Vine */}
                <path d="M70 6 Q 90 6 100 10 T 120 6" stroke="currentColor" strokeWidth="0.5" fill="none" />
            </svg>
        </div>
    );
}
