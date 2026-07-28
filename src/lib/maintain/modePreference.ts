/**
 * Remembered Build-vs-Maintain choice, per project root, in localStorage.
 *
 * The ModeChoiceDialog should ask ONCE per project — not on every app restart.
 * openProject consults `loadModeChoice(root)`: a remembered mode is applied
 * silently; only a project with no remembered choice shows the picker. Every
 * `chooseMode` (from the dialog or the top-bar toggle) persists via `saveModeChoice`.
 */

import type { ProjectMode } from "../engine/projectMode";

const KEY = "cadre-project-modes";

type ModeMap = Record<string, ProjectMode>;

function load(): ModeMap {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === "object" && !Array.isArray(v) ? (v as ModeMap) : {};
  } catch {
    return {};
  }
}

/** The remembered mode for `root`, or null if the user has never chosen for it. */
export function loadModeChoice(root: string): ProjectMode | null {
  const m = load()[root];
  return m === "build" || m === "maintain" ? m : null;
}

/** Persist the user's mode choice for `root`. Best-effort — storage may be unavailable. */
export function saveModeChoice(root: string, mode: ProjectMode): void {
  try {
    const map = load();
    map[root] = mode;
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable — the picker just shows again next open */
  }
}
