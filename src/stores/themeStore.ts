import { create } from "zustand";

/**
 * Theming. The palette lives in CSS tokens (src/styles/tokens.css); this store
 * only flips `data-theme` on <html> and remembers the preference.
 *
 * Three modes: "auto" follows the local clock (light 6:00–18:00, dark otherwise
 * and re-evaluated while the app is open); "light"/"dark" pin it. Applied
 * synchronously at module load so there's no first-paint flash.
 */
export type Theme = "dark" | "light";
export type ThemeMode = "auto" | "dark" | "light";

const MODE_KEY = "cadre-theme-mode";
const LEGACY_KEY = "cadre-theme"; // pre-auto: stored the resolved theme directly

/** Daytime → light. Uses the machine's local time. */
function isDaytime(): boolean {
  const h = new Date().getHours();
  return h >= 6 && h < 18;
}

function resolve(mode: ThemeMode): Theme {
  return mode === "auto" ? (isDaytime() ? "light" : "dark") : mode;
}

function readMode(): ThemeMode {
  try {
    const m = localStorage.getItem(MODE_KEY);
    if (m === "auto" || m === "dark" || m === "light") return m;
    const legacy = localStorage.getItem(LEGACY_KEY); // migrate an earlier manual choice
    if (legacy === "light" || legacy === "dark") return legacy;
  } catch {
    /* localStorage may be unavailable */
  }
  return "auto";
}

function applyTheme(_theme: Theme) {
  // data-theme is owned by the settings THEME PRESET (see settingsStore.applyThemeToDOM),
  // which is the single source of truth for light/dark. All current presets are dark,
  // so a light/dark override here would only re-create the dark-on-dark mismatch.
  // This is intentionally a no-op; kept so callers/state stay unchanged.
}

function persistMode(mode: ThemeMode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* no-op */
  }
}

const initialMode = readMode();
applyTheme(resolve(initialMode));

/** Cycle order for the single top-bar control. */
const NEXT: Record<ThemeMode, ThemeMode> = { auto: "light", light: "dark", dark: "auto" };

export const useThemeStore = create<{
  mode: ThemeMode;
  theme: Theme;
  setMode: (mode: ThemeMode) => void;
  cycle: () => void;
}>((setState, get) => {
  // While in "auto", re-check the clock so the theme flips at the day/night
  // boundary without a reload. Also on tab focus (laptop wake, etc.).
  if (typeof window !== "undefined") {
    const tick = () => {
      if (get().mode !== "auto") return;
      const t = resolve("auto");
      if (t !== get().theme) {
        applyTheme(t);
        setState({ theme: t });
      }
    };
    setInterval(tick, 60_000);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
  }

  return {
    mode: initialMode,
    theme: resolve(initialMode),
    setMode: (mode) => {
      persistMode(mode);
      const theme = resolve(mode);
      applyTheme(theme);
      setState({ mode, theme });
    },
    cycle: () => get().setMode(NEXT[get().mode]),
  };
});
