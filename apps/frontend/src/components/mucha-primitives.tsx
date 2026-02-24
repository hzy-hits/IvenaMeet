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
/* ─────────────────────────────────────────────
   2.1) High-Fidelity Mucha Assets
   ───────────────────────────────────────────── */

/**
 * A wrapper for opaque black-on-white PNG assets.
 * Uses CSS blend modes to knock out the white background.
 * Adapts to Dark/Twilight themes by inverting the colors.
 */
function MuchaAsset({ src, className = "", style }: { src: string, className?: string, style?: React.CSSProperties }) {
    // In light theme, 'dark:invert dark:mix-blend-screen' kicks in on dark mode.
    // By default, 'mix-blend-multiply' knocks out white.
    return (
        <img
            src={src}
            alt=""
            aria-hidden="true"
            className={`pointer-events-none absolute mix-blend-multiply dark:mix-blend-screen dark:invert opacity-25 object-contain ${className}`}
            style={style}
        />
    );
}

function MuchaCorner({ className = "", style }: { className?: string, style?: React.CSSProperties }) {
    return (
        <MuchaAsset
            src="/assets/mucha/corner.png"
            className={`w-8 h-8 ${className}`}
            style={style}
        />
    );
}

export function MuchaArch({ children, className = "" }: { children: ReactNode, className?: string }) {
    return (
        <div className={`relative ${className}`}>
            <MuchaAsset
                src="/assets/mucha/arch.png"
                className="inset-x-0 top-0 h-16 w-full opacity-20 object-fill"
            />
            <div className="relative z-10 pt-4">
                {children}
            </div>
        </div>
    );
}

export function MuchaHalo({ className = "" }: { className?: string }) {
    return (
        <img
            src="/assets/mucha/halo.png"
            alt=""
            aria-hidden="true"
            className={`pointer-events-none mix-blend-multiply dark:mix-blend-screen dark:invert opacity-[0.06] object-contain ${className}`}
        />
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
