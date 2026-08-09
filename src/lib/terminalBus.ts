/**
 * terminalBus — a tiny registry that lets a docked "thoughts" composer send text
 * into the ACTIVE terminal pane of a surface without threading pty ids through the
 * React tree. TerminalPanel registers its pty on mount (keyed by its persistId,
 * which is `<surfaceId>::<paneKey>`) and marks itself active when the user types in
 * it; the composer calls sendToActive(surfaceId, text).
 */
import { invoke } from "@tauri-apps/api/core";

const panes = new Map<string, number>();           // persistId -> ptyId
const activeBySurface = new Map<string, string>();  // surfaceId -> persistId

function surfaceOf(persistId: string): string {
  return persistId.split("::")[0];
}

export function registerPane(persistId: string, ptyId: number): void {
  panes.set(persistId, ptyId);
  const s = surfaceOf(persistId);
  if (!activeBySurface.has(s)) activeBySurface.set(s, persistId); // first pane is active by default
}

export function unregisterPane(persistId: string): void {
  panes.delete(persistId);
  const s = surfaceOf(persistId);
  if (activeBySurface.get(s) === persistId) {
    const next = [...panes.keys()].find((k) => surfaceOf(k) === s);
    if (next) activeBySurface.set(s, next);
    else activeBySurface.delete(s);
  }
}

/** Mark a pane active for its surface (called when the user focuses/types in it). */
export function markActive(persistId: string): void {
  activeBySurface.set(surfaceOf(persistId), persistId);
}

/** Write `text` into the active pane of `surfaceId`. Returns false if none is live. */
export async function sendToActive(surfaceId: string, text: string): Promise<boolean> {
  const persistId = activeBySurface.get(surfaceId);
  const ptyId = persistId ? panes.get(persistId) : undefined;
  if (ptyId == null) return false;
  await invoke("write_pty", { id: ptyId, data: Array.from(new TextEncoder().encode(text)) });
  return true;
}
