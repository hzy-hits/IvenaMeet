export type ThemeMode = "system" | "dark" | "light" | "twilight";
export type ResolvedTheme = "dark" | "light" | "twilight";

export const THEME_LS_KEY = "ivena.meet.theme_mode";

export function parseThemeMode(raw: string | null | undefined): ThemeMode {
    if (raw === "dark" || raw === "light" || raw === "system" || raw === "twilight") return raw;
    return "system";
}

export function readThemeMode(): ThemeMode {
    try {
        return parseThemeMode(localStorage.getItem(THEME_LS_KEY));
    } catch {
        return "system";
    }
}

export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): ResolvedTheme {
    if (mode === "system") return systemPrefersDark ? "dark" : "light";
    return mode;
}

export function applyResolvedTheme(theme: ResolvedTheme): void {
    document.documentElement.dataset.theme = theme;
    // twilight uses dark color-scheme for browser chrome (scrollbars, etc.)
    document.documentElement.style.colorScheme = theme === "light" ? "light" : "dark";
}
