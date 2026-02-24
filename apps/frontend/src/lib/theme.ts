export type ThemeMode = "system" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";

export const THEME_LS_KEY = "ivena.meet.theme_mode";

export function parseThemeMode(raw: string | null | undefined): ThemeMode {
  if (raw === "dark" || raw === "light" || raw === "system") return raw;
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
  document.documentElement.style.colorScheme = theme;
}
