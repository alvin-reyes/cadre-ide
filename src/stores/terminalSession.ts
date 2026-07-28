/**
 * Terminal session persistence — remembers, per "surface" (a project's Maintain
 * cockpit or its dock Terminal view), the open terminal tabs/panes and each
 * pane's serialized scrollback, so relaunching the app restores the layout and
 * visible history. A live process (a running `claude`/shell) can't survive a
 * quit, so on restore each pane re-spawns a fresh PTY beneath its restored
 * scrollback (and re-runs its startup command, e.g. `claude`).
 *
 * Structure and buffers are stored under separate keys: structure changes rarely
 * (open/close/split), buffers change constantly (serialized on an interval).
 */

const STRUCT_KEY = "cadre-terminal-structure";
const BUF_KEY = "cadre-terminal-buffers";

/** Cap a single pane's persisted scrollback so localStorage can't blow up. */
const MAX_BUFFER = 48_000;

export interface PaneSnap {
  key: string;
  cwd: string;
  startupCommand?: string;
}
export interface TabSnap {
  id: string;
  panes: PaneSnap[];
}

type StructMap = Record<string, TabSnap[]>;
type BufferMap = Record<string, string>;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable / quota — persistence is best-effort */
  }
}

/** The remembered tab/pane structure for a surface, or null if none saved. */
export function loadStructure(surfaceId: string): TabSnap[] | null {
  const map = readJson<StructMap>(STRUCT_KEY, {});
  const tabs = map[surfaceId];
  return Array.isArray(tabs) && tabs.length > 0 ? tabs : null;
}

export function saveStructure(surfaceId: string, tabs: TabSnap[]): void {
  const map = readJson<StructMap>(STRUCT_KEY, {});
  map[surfaceId] = tabs;
  writeJson(STRUCT_KEY, map);
}

/** persistId identifies one pane across restarts: `${surfaceId}::${paneKey}`. */
export function loadBuffer(persistId: string): string | null {
  return readJson<BufferMap>(BUF_KEY, {})[persistId] ?? null;
}

export function saveBuffer(persistId: string, buffer: string): void {
  const map = readJson<BufferMap>(BUF_KEY, {});
  // Keep only the tail when a buffer is very large.
  map[persistId] = buffer.length > MAX_BUFFER ? buffer.slice(buffer.length - MAX_BUFFER) : buffer;
  writeJson(BUF_KEY, map);
}

export function clearBuffer(persistId: string): void {
  const map = readJson<BufferMap>(BUF_KEY, {});
  if (persistId in map) {
    delete map[persistId];
    writeJson(BUF_KEY, map);
  }
}
