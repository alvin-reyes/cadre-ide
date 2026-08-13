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

// Spy on the MCP tracker sync — a separate agent owns mcpTrackerStore.ts, so
// we only import from it here (never edit it). syncStory is mocked so these
// tests assert bmadStore's call shape without spawning any real sync.
const { mcpSyncStoryStub } = vi.hoisted(() => ({
  mcpSyncStoryStub: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./mcpTrackerStore", () => ({
  useMcpTrackerStore: {
    getState: () => ({ syncStory: mcpSyncStoryStub }),
  },
}));

import { useBmadStore } from "./bmadStore";
import { emptyBmadSlice, emptyCadreSlice } from "../lib/engine/projectSlices";
import { emptyBoard, boardStories } from "../lib/engine/board";
import { useCadre } from "../cadre/useCadre";

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
  mcpSyncStoryStub.mockClear();
  mcpSyncStoryStub.mockResolvedValue(undefined);
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

describe("bmadStore.setStatus — MCP tracker sync", () => {
  // Seed a single project at /mcp with a known story (so `title` resolves from
  // the board rather than the epic.story fallback) and a frozen verification
  // command in useCadre (so `verifyCmd` is populated for the assertion).
  function seedProjectWithStory() {
    // `setStatus` reads the story's title via get().projects[root].stories, which
    // pushRoot always re-derives from the board (boardStories) — so the title has
    // to live on the board card itself, not just the slice's `stories` mirror.
    const seededBoard = {
      stories: { "4.5": { id: "4.5", epic: 4, story: 5, title: "Wire up sync", status: "Draft" as const } },
    };
    useBmadStore.setState({
      projects: {
        "/mcp": { ...emptyBmadSlice(), board: seededBoard, stories: boardStories(seededBoard) },
      },
      activeRoot: "/mcp",
      projectRoot: "/mcp",
      board: emptyBoard(),
      stories: [],
      watchError: null,
    });
    useCadre.setState({
      projects: { "/mcp": { ...emptyCadreSlice(), verification: ["npm test", "npm run lint"] } },
    });
  }

  it("calls mcpTrackerStore.syncStory with the story title and verify command on a successful transition to Done", async () => {
    seedProjectWithStory();

    await useBmadStore.getState().setStatus(4, 5, "Done", "/mcp");

    expect(mcpSyncStoryStub).toHaveBeenCalledWith(
      "/mcp",
      { epic: 4, story: 5, title: "Wire up sync" },
      "Done",
      "npm test && npm run lint",
      [{ epic: 4, story: 5, status: "Done" }]
    );
  });

  it("does NOT call mcpTrackerStore.syncStory for a transition to Draft (shouldSync is false)", async () => {
    seedProjectWithStory();

    await useBmadStore.getState().setStatus(4, 5, "Draft", "/mcp");

    expect(mcpSyncStoryStub).not.toHaveBeenCalled();
  });

  it("does NOT call mcpTrackerStore.syncStory when story_set_status rejects, and rolls back the board", async () => {
    seedProjectWithStory();
    invokeStub.mockRejectedValueOnce(new Error("illegal transition"));

    await expect(
      useBmadStore.getState().setStatus(4, 5, "Done", "/mcp")
    ).rejects.toThrow("illegal transition");

    expect(mcpSyncStoryStub).not.toHaveBeenCalled();
    // Rolled back: the optimistic "Done" write never lands — the card reverts
    // to its pre-transition status since story_set_status never resolved.
    expect(useBmadStore.getState().projects["/mcp"]?.board.stories["4.5"]?.status).toBe("Draft");
  });
});

describe("bmadStore.openProject — git-repo auto-init", () => {
  // Route invoke by command + args. run_git's rev-parse --is-inside-work-tree
  // drives detection; a `git init` on a non-git folder is simulated separately so
  // we can assert it runs (and can be made to fail). list_directory returns empty.
  function mockGit(isGit: boolean, initOk = true) {
    invokeStub.mockImplementation((cmd: string, payload?: { args?: string[] }) => {
      if (cmd === "run_git") {
        const args = payload?.args ?? [];
        if (args[0] === "init") {
          return Promise.resolve({
            exit_code: initOk ? 0 : 128,
            stdout: "",
            stderr: initOk ? "" : "fatal: could not create work tree",
            timed_out: false,
          });
        }
        // rev-parse --is-inside-work-tree
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

  it("initializes git for a non-git folder, then opens it", async () => {
    useBmadStore.setState({ projects: {}, activeRoot: "/existing" });
    mockGit(false);

    await useBmadStore.getState().openProject("/not-a-repo");

    // `git init` ran, then the project opened normally.
    expect(invokeStub).toHaveBeenCalledWith("run_git", { cwd: "/not-a-repo", args: ["init"] });
    const state = useBmadStore.getState();
    expect(state.projects["/not-a-repo"]).toBeDefined();
    expect(state.activeRoot).toBe("/not-a-repo");
    expect(invokeStub).toHaveBeenCalledWith("open_project", { root: "/not-a-repo" });
  });

  it("opens an existing git repo without re-initializing", async () => {
    useBmadStore.setState({ projects: {}, activeRoot: "/existing" });
    mockGit(true);

    await useBmadStore.getState().openProject("/a-repo");

    const state = useBmadStore.getState();
    expect(state.projects["/a-repo"]).toBeDefined();
    expect(state.activeRoot).toBe("/a-repo");
    expect(invokeStub).toHaveBeenCalledWith("open_project", { root: "/a-repo" });
    expect(invokeStub).not.toHaveBeenCalledWith("run_git", { cwd: "/a-repo", args: ["init"] });
  });

  it("surfaces an error and does NOT open when git init fails", async () => {
    useBmadStore.setState({ projects: {}, activeRoot: "/existing" });
    mockGit(false, false); // init itself fails (e.g. git missing)

    await expect(
      useBmadStore.getState().openProject("/broken")
    ).rejects.toThrow(/Could not initialize a git repository/);

    const state = useBmadStore.getState();
    expect(state.projects["/broken"]).toBeUndefined();
    expect(state.activeRoot).toBe("/existing");
    expect(invokeStub).not.toHaveBeenCalledWith("open_project", expect.anything());
  });
});
