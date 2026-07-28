/**
 * Remembered active view (Orchestrator / Files / Terminal / Context), per project
 * root, in localStorage — so reopening a project (or relaunching the app) lands on
 * the view you left it on instead of always resetting to the Orchestrator.
 *
 * Values are stored as plain strings; the caller validates against its own view
 * union before use, so an unknown/renamed view degrades gracefully to the default.
 */

const KEY = "cadre-project-views";

type ViewMap = Record<string, string>;

function load(): ViewMap {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === "object" && !Array.isArray(v) ? (v as ViewMap) : {};
  } catch {
    return {};
  }
}

/** The remembered view id for `root`, or null if none saved. */
export function loadView(root: string): string | null {
  return load()[root] ?? null;
}

/** Persist the active view for `root`. Best-effort — storage may be unavailable. */
export function saveView(root: string, view: string): void {
  try {
    const map = load();
    map[root] = view;
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable — the view just defaults next open */
  }
}
