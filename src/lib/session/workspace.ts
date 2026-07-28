/**
 * Capture / restore the current session as a named workspace snapshot.
 *
 * Capture reads the open-projects list plus each project's remembered mode/view.
 * Restore writes those prefs back (so the normal open path applies them), reconciles
 * the open-projects tab list to the snapshot, opens every project, and foregrounds
 * the snapshot's active one. A project that no longer opens (e.g. folder deleted) is
 * skipped rather than aborting the whole restore.
 */

import { useOpenProjects } from "../../stores/openProjectsStore";
import { useBmadStore } from "../../stores/bmadStore";
import { useCadre } from "../../cadre/useCadre";
import { loadModeChoice, saveModeChoice } from "../maintain/modePreference";
import { loadView, saveView } from "../../stores/viewPreference";
import { buildSnapshot, type WorkspaceSnapshot } from "../../stores/workspaceSnapshots";
import type { ProjectMode } from "../engine/projectMode";

function basename(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

export function captureSession(name: string, id: string, savedAt: number): WorkspaceSnapshot {
  const { roots, activeRoot, names } = useOpenProjects.getState();
  return buildSnapshot({
    id,
    name,
    savedAt,
    activeRoot,
    roots,
    nameOf: (r) => names[r] ?? basename(r),
    modeOf: (r) => (loadModeChoice(r) ?? "build") as ProjectMode,
    viewOf: (r) => loadView(r) ?? "orchestrator",
  });
}

export async function restoreSession(snap: WorkspaceSnapshot): Promise<void> {
  // 1. Persist each project's mode + view so the normal open path applies them.
  for (const p of snap.projects) {
    saveModeChoice(p.root, p.mode);
    saveView(p.root, p.view);
  }
  // 2. Reconcile the open-projects tab list to the snapshot: close what isn't in it,
  //    register what is.
  const keep = new Set(snap.projects.map((p) => p.root));
  useOpenProjects
    .getState()
    .roots.filter((r) => !keep.has(r))
    .forEach((r) => useOpenProjects.getState().close(r));
  snap.projects.forEach((p) => useOpenProjects.getState().open(p.root, p.name));

  // 3. Open every project (skip any that fail), then foreground the active one.
  await Promise.all(
    snap.projects.map((p) => useBmadStore.getState().openProject(p.root).catch(() => {}))
  );
  const target = snap.activeRoot ?? snap.projects[0]?.root ?? null;
  if (target) {
    useBmadStore.getState().setActiveProject(target);
    useCadre.getState().setActiveProject(target);
    useOpenProjects.getState().setActive(target);
  }
}
