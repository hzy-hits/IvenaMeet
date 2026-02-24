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
        <Tag className={`paper-grain relative shadow-mucha ${TONE_BG[tone]} ${className}`}>
            {children}
        </Tag>
    );
}

/* ─────────────────────────────────────────────
   2) OrnamentFrame
   Thin gold border with subtle corner emphasis.
   Decoration lives on the EDGES only.
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
            ? "border border-gold/90"
            : "border border-gold/45";

    return (
        <div className={`relative ${borderClass} rounded-panel ${className}`}>
            {/* Corner ornaments — tiny gold diamonds at each corner */}
            <span
                aria-hidden="true"
                className="pointer-events-none absolute -left-[3px] -top-[3px] h-1.5 w-1.5 rounded-sm bg-gold/60"
            />
            <span
                aria-hidden="true"
                className="pointer-events-none absolute -right-[3px] -top-[3px] h-1.5 w-1.5 rounded-sm bg-gold/60"
            />
            <span
                aria-hidden="true"
                className="pointer-events-none absolute -bottom-[3px] -left-[3px] h-1.5 w-1.5 rounded-sm bg-gold/60"
            />
            <span
                aria-hidden="true"
                className="pointer-events-none absolute -bottom-[3px] -right-[3px] h-1.5 w-1.5 rounded-sm bg-gold/60"
            />
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
        <div
            aria-hidden="true"
            className={`ornate-divider my-3 ${className}`}
        />
    );
}
