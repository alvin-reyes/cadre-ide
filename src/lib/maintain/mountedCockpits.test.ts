import { describe, it, expect } from "vitest";
import { nextMountedRoots, nextMountedSurfaces } from "./mountedCockpits";

/**
 * The Maintain cockpit used to be a singleton re-pointed at the active project, so
 * switching project tabs unmounted it and killed its PTY (and the claude session in
 * it). These tests pin the replacement policy: which roots keep a mounted cockpit.
 */
describe("nextMountedRoots", () => {
  const openRoots = ["/a", "/b"];

  it("mounts nothing when no project is active", () => {
    expect(
      nextMountedRoots({ mounted: [], openRoots, activeRoot: null, activeMode: "maintain" })
    ).toEqual([]);
  });

  it("lazily mounts the active root when it enters Maintain mode", () => {
    expect(
      nextMountedRoots({ mounted: [], openRoots, activeRoot: "/a", activeMode: "maintain" })
    ).toEqual(["/a"]);
  });

  it("does NOT mount a Build-mode project", () => {
    // Opening five Build projects must not spawn five terminals.
    expect(
      nextMountedRoots({ mounted: [], openRoots, activeRoot: "/a", activeMode: "build" })
    ).toEqual([]);
  });

  it("keeps a previously-mounted root when the active project switches away", () => {
    // THE REGRESSION: /a's cockpit must survive switching to /b, or its PTY dies.
    expect(
      nextMountedRoots({ mounted: ["/a"], openRoots, activeRoot: "/b", activeMode: "maintain" })
    ).toEqual(["/a", "/b"]);
  });

  it("keeps a previously-mounted root even when the new active project is Build mode", () => {
    expect(
      nextMountedRoots({ mounted: ["/a"], openRoots, activeRoot: "/b", activeMode: "build" })
    ).toEqual(["/a"]);
  });

  it("drops a root once its project tab is closed", () => {
    // Closing a project is the one place teardown is correct.
    expect(
      nextMountedRoots({ mounted: ["/a", "/b"], openRoots: ["/b"], activeRoot: "/b", activeMode: "maintain" })
    ).toEqual(["/b"]);
  });

  it("does not mount an active root that is not open", () => {
    expect(
      nextMountedRoots({ mounted: [], openRoots: ["/b"], activeRoot: "/a", activeMode: "maintain" })
    ).toEqual([]);
  });

  it("is idempotent — calling twice changes nothing", () => {
    const input = { mounted: ["/a"], openRoots, activeRoot: "/a", activeMode: "maintain" as const };
    const once = nextMountedRoots(input);
    expect(nextMountedRoots({ ...input, mounted: once })).toEqual(once);
  });

  it("preserves order so React keys stay stable", () => {
    expect(
      nextMountedRoots({
        mounted: ["/b", "/a"],
        openRoots: ["/a", "/b", "/c"],
        activeRoot: "/c",
        activeMode: "maintain",
      })
    ).toEqual(["/b", "/a", "/c"]);
  });

  it("never duplicates an already-mounted active root", () => {
    expect(
      nextMountedRoots({ mounted: ["/a"], openRoots, activeRoot: "/a", activeMode: "maintain" })
    ).toEqual(["/a"]);
  });

  it("returns a value equal to the input when nothing changes (no needless re-render)", () => {
    const mounted = ["/a"];
    const out = nextMountedRoots({ mounted, openRoots, activeRoot: "/a", activeMode: "maintain" });
    expect(out).toEqual(mounted);
  });
});

describe("nextMountedSurfaces (dock terminal)", () => {
  const openRoots = ["/a", "/b"];

  it("mounts the active root when the surface is wanted", () => {
    expect(
      nextMountedSurfaces({ mounted: [], openRoots, activeRoot: "/a", wantActive: true })
    ).toEqual(["/a"]);
  });

  it("does not mount when the surface is not wanted", () => {
    expect(
      nextMountedSurfaces({ mounted: [], openRoots, activeRoot: "/a", wantActive: false })
    ).toEqual([]);
  });

  it("keeps an already-mounted dock terminal across a project switch", () => {
    // The dock terminal had the same keyed-remount defect as the cockpit.
    expect(
      nextMountedSurfaces({ mounted: ["/a"], openRoots, activeRoot: "/b", wantActive: false })
    ).toEqual(["/a"]);
  });

  it("drops a root when its project closes", () => {
    expect(
      nextMountedSurfaces({ mounted: ["/a", "/b"], openRoots: ["/a"], activeRoot: "/a", wantActive: true })
    ).toEqual(["/a"]);
  });
});
