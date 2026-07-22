import { create } from "zustand";

/**
 * Light / dark theming. The palette lives in CSS tokens (src/styles/tokens.css);
 * this store only flips `data-theme` on <html> and remembers the choice.
 * Applied synchronously at module load so there's no first-paint flash.
 */
export type Theme = "dark" | "light";

const KEY = "cadre-theme";

function readStored(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* localStorage may be unavailable */
  }
  return "dark";
}

function apply(theme: Theme) {
  try {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(KEY, theme);
  } catch {
    /* no-op outside the browser */
  }
}

const initial = readStored();
apply(initial);

export const useThemeStore = create<{ theme: Theme; toggle: () => void; set: (t: Theme) => void }>(
  (setState, get) => ({
    theme: initial,
    toggle: () => {
      const next: Theme = get().theme === "dark" ? "light" : "dark";
      apply(next);
      setState({ theme: next });
    },
    set: (theme) => {
      apply(theme);
      setState({ theme });
    },
  })
);
