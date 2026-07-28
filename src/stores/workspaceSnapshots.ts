/**
 * Named workspace snapshots — save/restore a whole session: which projects are
 * open, their Build/Maintain mode, and their active view. Distinct from the legacy
 * `WorkspacePreset` (terminal-tab layouts). Persisted to localStorage.
 *
 * Restore reuses the per-project persistence (modePreference / viewPreference /
 * terminalSession): it writes each project's remembered mode + view, then opens the
 * projects, so the normal open path applies everything.
 */

import { create } from "zustand";
import type { ProjectMode } from "../lib/engine/projectMode";

export interface SnapshotProject {
  root: string;
  name: string;
  mode: ProjectMode;
  view: string;
}

export interface WorkspaceSnapshot {
  id: string;
  name: string;
  savedAt: number;
  activeRoot: string | null;
  projects: SnapshotProject[];
}

const KEY = "cadre-workspace-snapshots";

function load(): WorkspaceSnapshot[] {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? (v as WorkspaceSnapshot[]) : [];
  } catch {
    return [];
  }
}

function persist(list: WorkspaceSnapshot[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable — snapshots are best-effort */
  }
}

/**
 * Pure builder for a snapshot from the current session, given accessors. Exported
 * for testing and so the capture glue stays a thin wiring layer.
 */
export function buildSnapshot(input: {
  id: string;
  name: string;
  savedAt: number;
  activeRoot: string | null;
  roots: string[];
  nameOf: (root: string) => string;
  modeOf: (root: string) => ProjectMode;
  viewOf: (root: string) => string;
}): WorkspaceSnapshot {
  return {
    id: input.id,
    name: input.name.trim() || "Untitled workspace",
    savedAt: input.savedAt,
    activeRoot: input.activeRoot,
    projects: input.roots.map((root) => ({
      root,
      name: input.nameOf(root),
      mode: input.modeOf(root),
      view: input.viewOf(root),
    })),
  };
}

interface State {
  snapshots: WorkspaceSnapshot[];
  /** Add (or replace by id) a snapshot, newest first. */
  save: (snap: WorkspaceSnapshot) => void;
  remove: (id: string) => void;
}

export const useWorkspaceSnapshots = create<State>((set) => ({
  snapshots: load(),
  save: (snap) =>
    set((s) => {
      const list = [snap, ...s.snapshots.filter((x) => x.id !== snap.id)];
      persist(list);
      return { snapshots: list };
    }),
  remove: (id) =>
    set((s) => {
      const list = s.snapshots.filter((x) => x.id !== id);
      persist(list);
      return { snapshots: list };
    }),
}));
