export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "nodedr-pos-theme";

export function resolveInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage unavailable (private mode, disabled) — fall through to system preference.
  }
  // Light is the product default; only an explicit choice (the toggle) switches it.
  return "light";
}

/**
 * Runs synchronously during HTML parsing (before first paint) so the correct
 * theme is on <html> before React ever mounts. Mirrors resolveInitialTheme()
 * exactly so the client's lazy useState initializer agrees with the DOM the
 * script already set — see Next's "preventing flash before hydration" guide.
 */
export const themeInitScript = `(function(){try{var k=${JSON.stringify(
  THEME_STORAGE_KEY
)};var s=localStorage.getItem(k);var t=(s==="light"||s==="dark")?s:"light";document.documentElement.setAttribute("data-theme",t);document.documentElement.style.colorScheme=t;}catch(e){}})();`;
