/**
 * Per-project persistence of the Maintain view's STAGED task list (not the live
 * batches — those hold PTYs that die on quit). Keyed by project root under one
 * localStorage map, mirroring terminalSession's structure storage.
 */
import type { StagedTask } from "../lib/maintain/tasks";

const KEY = "cadre-maintain-staged";
type StagedMap = Record<string, StagedTask[]>;

function read(): StagedMap {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    return raw ? (JSON.parse(raw) as StagedMap) : {};
  } catch { return {}; }
}

export function loadStaged(root: string): StagedTask[] {
  return read()[root] ?? [];
}

export function saveStaged(root: string, tasks: StagedTask[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    const map = read();
    if (tasks.length) map[root] = tasks; else delete map[root];
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch { /* quota / unavailable */ }
}
