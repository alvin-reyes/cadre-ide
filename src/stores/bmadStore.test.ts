/**
 * bmadStore.test.ts — verifies that setStatus routes to the EXPLICIT root arg,
 * not the active root, so background dispatches never corrupt the foreground
 * project's board slice.
 *
 * We mock @tauri-apps/api/core so no Tauri runtime is needed. Slices are seeded
 * directly via setState to keep the suite hermetic (no openProject call needed).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted to the top of the file, so we use vi.hoisted to declare
// the stub before the mock factory runs.
const { invokeStub } = vi.hoisted(() => ({
  invokeStub: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeStub,
  Channel: class {
    onmessage: ((evt: unknown) => void) | null = null;
  },
}));

import { useBmadStore } from "./bmadStore";
import { emptyBmadSlice } from "../lib/engine/projectSlices";
import { emptyBoard } from "../lib/engine/board";

// Helper: seed two project slices and set /b as the active root.
function seedTwoProjects() {
  useBmadStore.setState({
    projects: {
      "/a": emptyBmadSlice(),
      "/b": emptyBmadSlice(),
    },
    activeRoot: "/b",
    projectRoot: "/b",
    board: emptyBoard(),
    stories: [],
    watchError: null,
  });
}

beforeEach(() => {
  invokeStub.mockClear();
  invokeStub.mockResolvedValue(undefined);
});

describe("bmadStore.setStatus — root routing", () => {
  it("routes an explicit root arg to the correct project slice, ignoring activeRoot", async () => {
    seedTwoProjects();

    // Active is /b; dispatch targets /a explicitly.
    await useBmadStore.getState().setStatus(1, 1, "InProgress", "/a");

    const state = useBmadStore.getState();

    // /a's board should have the 1.1 card at InProgress.
    expect(state.projects["/a"]?.board.stories["1.1"]?.status).toBe("InProgress");

    // /b's board must NOT have been touched.
    expect(state.projects["/b"]?.board.stories["1.1"]).toBeUndefined();

    // invoke was called with root: "/a" (not "/b").
    expect(invokeStub).toHaveBeenCalledWith("story_set_status", {
      root: "/a",
      epic: 1,
      story: 1,
      status: "InProgress",
    });
  });

  it("defaults to the activeRoot when no explicit root is provided", async () => {
    seedTwoProjects(); // active = /b

    await useBmadStore.getState().setStatus(2, 3, "Done");

    const state = useBmadStore.getState();

    // /b (activeRoot) should be updated.
    expect(state.projects["/b"]?.board.stories["2.3"]?.status).toBe("Done");

    // /a must remain untouched.
    expect(state.projects["/a"]?.board.stories["2.3"]).toBeUndefined();

    // invoke was called with root: "/b".
    expect(invokeStub).toHaveBeenCalledWith("story_set_status", {
      root: "/b",
      epic: 2,
      story: 3,
      status: "Done",
    });
  });

  it("rolls back the correct slice on invoke failure, without touching activeRoot slice", async () => {
    seedTwoProjects(); // active = /b

    // Simulate the engine rejecting the transition on /a.
    invokeStub.mockRejectedValueOnce(new Error("illegal transition"));

    await expect(
      useBmadStore.getState().setStatus(1, 1, "Done", "/a")
    ).rejects.toThrow("illegal transition");

    const state = useBmadStore.getState();

    // /a's board should have been rolled back to its prior state (no 1.1 card).
    expect(state.projects["/a"]?.board.stories["1.1"]).toBeUndefined();

    // /b must remain completely unaffected.
    expect(state.projects["/b"]?.board.stories["1.1"]).toBeUndefined();
  });
});

describe("bmadStore.openProject — git-repo gate", () => {
  // Route invoke by command so we can simulate a git / non-git folder. run_git's
  // rev-parse --is-inside-work-tree drives the gate; list_directory returns empty.
  function mockGit(isGit: boolean) {
    invokeStub.mockImplementation((cmd: string) => {
      if (cmd === "run_git") {
        return Promise.resolve({
          exit_code: isGit ? 0 : 128,
          stdout: isGit ? "true\n" : "",
          stderr: isGit ? "" : "fatal: not a git repository",
          timed_out: false,
        });
      }
      if (cmd === "list_directory") return Promise.resolve([]);
      return Promise.resolve(undefined); // open_project, watch_directory, …
    });
  }

  it("rejects a non-git folder and does NOT seed the slice or open the project", async () => {
    useBmadStore.setState({ projects: {}, activeRoot: "/existing" });
    mockGit(false);

    await expect(
      useBmadStore.getState().openProject("/not-a-repo")
    ).rejects.toThrow(/not a git repository/);

    const state = useBmadStore.getState();
    // No slice seeded, active root unchanged, open_project never invoked.
    expect(state.projects["/not-a-repo"]).toBeUndefined();
    expect(state.activeRoot).toBe("/existing");
    expect(invokeStub).not.toHaveBeenCalledWith("open_project", expect.anything());
  });

  it("opens a git repo: seeds the slice, makes it active, and calls open_project", async () => {
    useBmadStore.setState({ projects: {}, activeRoot: "/existing" });
    mockGit(true);

    await useBmadStore.getState().openProject("/a-repo");

    const state = useBmadStore.getState();
    expect(state.projects["/a-repo"]).toBeDefined();
    expect(state.activeRoot).toBe("/a-repo");
    expect(invokeStub).toHaveBeenCalledWith("open_project", { root: "/a-repo" });
  });
});
