/**
 * Light/dark theme handling for SavePoint.
 *
 * theme.css defines both palettes under `.light|[data-theme="light"]` and
 * `.dark|[data-theme="dark"]`. We drive it by setting `data-theme` AND toggling
 * the `dark` class on <html> (belt-and-suspenders for HeroUI + Tailwind).
 * The preference is persisted to localStorage and falls back to the OS setting.
 */
export type ThemeMode = "light" | "dark";

const STORAGE_KEY = "savepoint-theme";

export function getStoredTheme(): ThemeMode | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

export function getSystemTheme(): ThemeMode {
  if (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
}

export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.classList.toggle("dark", mode === "dark");
  root.style.colorScheme = mode;
}

/** Read the mode currently applied to <html> (defaults to light). */
export function getCurrentTheme(): ThemeMode {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/** Apply the stored preference, or the OS preference if none is stored. */
export function initTheme(): ThemeMode {
  const mode = getStoredTheme() ?? getSystemTheme();
  applyTheme(mode);
  return mode;
}

/** Flip the theme, persist it, and return the new mode. */
export function toggleTheme(): ThemeMode {
  const next: ThemeMode = getCurrentTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // ignore write failures (e.g. private mode / storage disabled)
  }
  return next;
}
