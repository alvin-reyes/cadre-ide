import type { ProjectMode } from "../engine/projectMode";

/**
 * Which project roots keep a mounted Maintain cockpit.
 *
 * The cockpit used to be a singleton re-pointed at the active project, so a project
 * switch changed `key={projectRoot}`, unmounted the terminal subtree, and
 * TerminalPanel's cleanup called kill_pty — killing the PTY and the claude session
 * inside it. Destroying it was how the singleton avoided leaking one project's
 * terminal into another; keeping one instance PER ROOT solves the leak without the
 * teardown.
 *
 * Policy: keep every already-mounted root that is still open, and lazily add the
 * active root once it enters Maintain mode. Order is preserved because these become
 * React keys, and a reordered list would remount the very panes this exists to keep
 * alive. Closing a project tab is the one place teardown is correct — a root that
 * leaves `openRoots` is dropped, and its PTY dies with it.
 */
export function nextMountedRoots(input: {
  mounted: string[];
  openRoots: string[];
  activeRoot: string | null;
  activeMode: ProjectMode;
}): string[] {
  const { mounted, openRoots, activeRoot, activeMode } = input;
  return nextMountedSurfaces({
    mounted,
    openRoots,
    activeRoot,
    wantActive: activeMode === "maintain",
  });
}

/**
 * The same policy for any per-project surface that must survive a project switch.
 * The dock terminal (`dock:<root>`) has the identical defect as the cockpit — it was
 * keyed on the active root, so switching projects killed its PTY too — but its
 * "should this root be mounted" condition is the Terminal view being open rather
 * than Maintain mode, hence the boolean.
 */
export function nextMountedSurfaces(input: {
  mounted: string[];
  openRoots: string[];
  activeRoot: string | null;
  wantActive: boolean;
}): string[] {
  const { mounted, openRoots, activeRoot, wantActive } = input;
  const open = new Set(openRoots);

  const kept = mounted.filter((r) => open.has(r));

  const shouldAdd =
    activeRoot !== null && wantActive && open.has(activeRoot) && !kept.includes(activeRoot);

  return shouldAdd ? [...kept, activeRoot] : kept;
}
