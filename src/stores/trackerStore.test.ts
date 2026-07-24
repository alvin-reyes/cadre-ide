import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseRepoFromRemote } from "./trackerStore";

describe("parseRepoFromRemote", () => {
  // ── SSH form ────────────────────────────────────────────────────────────────

  it("parses SSH URL with .git suffix", () => {
    expect(parseRepoFromRemote("git@github.com:owner/repo.git")).toBe(
      "owner/repo"
    );
  });

  it("parses SSH URL without .git suffix", () => {
    expect(parseRepoFromRemote("git@github.com:owner/repo")).toBe("owner/repo");
  });

  it("preserves org/repo casing in SSH form", () => {
    expect(parseRepoFromRemote("git@github.com:MyOrg/MyRepo.git")).toBe(
      "MyOrg/MyRepo"
    );
  });

  // ── HTTPS form ──────────────────────────────────────────────────────────────

  it("parses HTTPS URL with .git suffix", () => {
    expect(
      parseRepoFromRemote("https://github.com/owner/repo.git")
    ).toBe("owner/repo");
  });

  it("parses HTTPS URL without .git suffix", () => {
    expect(
      parseRepoFromRemote("https://github.com/owner/repo")
    ).toBe("owner/repo");
  });

  it("parses HTTP (non-TLS) HTTPS URL", () => {
    expect(
      parseRepoFromRemote("http://github.com/owner/repo.git")
    ).toBe("owner/repo");
  });

  // ── Non-GitHub / unparseable ────────────────────────────────────────────────

  it("returns null for a GitLab SSH URL", () => {
    expect(parseRepoFromRemote("git@gitlab.com:owner/repo.git")).toBeNull();
  });

  it("returns null for a GitLab HTTPS URL", () => {
    expect(
      parseRepoFromRemote("https://gitlab.com/owner/repo.git")
    ).toBeNull();
  });

  it("returns null for a Bitbucket URL", () => {
    expect(
      parseRepoFromRemote("https://bitbucket.org/owner/repo.git")
    ).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseRepoFromRemote("")).toBeNull();
  });

  it("returns null for a whitespace-only string", () => {
    expect(parseRepoFromRemote("   ")).toBeNull();
  });

  it("returns null for a completely unrecognised string", () => {
    expect(parseRepoFromRemote("not-a-url")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Store-level tests: syncStory serialization, disabled guard, persistence/reuse
// ---------------------------------------------------------------------------
//
// We mock @tauri-apps/api/core (invoke) so no Tauri runtime is needed.
// The pattern follows bmadStore.test.ts (vi.hoisted + vi.mock).

const { invokeStub } = vi.hoisted(() => ({
  invokeStub: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeStub,
  Channel: class {
    onmessage: ((evt: unknown) => void) | null = null;
  },
}));

// Import the store AFTER the mock is set up.
import { useTrackerStore } from "./trackerStore";

/** Seed the store with an enabled tracker config for a given repo. */
function seedEnabled(repo = "owner/repo", issues: Record<string, number> = {}) {
  useTrackerStore.setState({
    config: { enabled: true, repo },
    issues,
    ghReady: true,
  });
}

/** Build a run_gh mock response for creating a GitHub issue that returns the
 *  given issue number. */
function ghCreateResponse(number: number) {
  return {
    stdout: JSON.stringify({ number }),
    stderr: "",
    exit_code: 0,
    timed_out: false,
  };
}

/** A run_gh response for a PATCH or POST comment (no meaningful body). */
const ghOkResponse = {
  stdout: "{}",
  stderr: "",
  exit_code: 0,
  timed_out: false,
};

beforeEach(() => {
  invokeStub.mockReset();
  // Default: write_text_file succeeds (for persisting the tracker file after sync).
  invokeStub.mockResolvedValue(ghOkResponse);
  // Reset the store to a clean disabled state before each test.
  useTrackerStore.setState({
    config: { enabled: false, repo: "" },
    issues: {},
    ghReady: null,
  });
});

describe("trackerStore.syncStory — disabled guard", () => {
  it("makes ZERO run_gh calls when config.enabled is false", async () => {
    // Store is disabled (default from beforeEach).
    const story = { epic: 1, story: 1, title: "Test story" };
    await useTrackerStore.getState().syncStory("/project", story, "InProgress");
    // No invoke at all — neither run_gh nor write_text_file.
    expect(invokeStub).not.toHaveBeenCalled();
  });

  it("makes ZERO run_gh calls when repo is empty", async () => {
    useTrackerStore.setState({ config: { enabled: true, repo: "" }, issues: {} });
    const story = { epic: 1, story: 1, title: "Test story" };
    await useTrackerStore.getState().syncStory("/project", story, "InProgress");
    expect(invokeStub).not.toHaveBeenCalled();
  });
});

describe("trackerStore.syncStory — persistence and reuse", () => {
  it("creates an issue on first sync and persists the issue number", async () => {
    seedEnabled("owner/repo");

    // read_file (for write_text_file call inside writeTrackerFile) is not
    // called here; only write_text_file and run_gh are. Set up run_gh to
    // return the created issue, and write_text_file to succeed.
    invokeStub.mockImplementation((cmd: string) => {
      if (cmd === "run_gh") return Promise.resolve(ghCreateResponse(7));
      if (cmd === "write_text_file") return Promise.resolve(undefined);
      return Promise.resolve(ghOkResponse);
    });

    const story = { epic: 1, story: 1, title: "Feature A" };
    await useTrackerStore.getState().syncStory("/project", story, "InProgress");

    // The issue should now be persisted in the store.
    expect(useTrackerStore.getState().issues["1.1"]).toBe(7);

    // Count CREATE calls (POST to repos/.../issues without -X PATCH).
    const createCalls = invokeStub.mock.calls.filter((c: unknown[]) => {
      const cmd = c[0] as string;
      const args = c[1] as { args: string[] } | undefined;
      return (
        cmd === "run_gh" &&
        Array.isArray(args?.args) &&
        (args?.args[1] ?? "").includes("/issues") &&
        !args?.args.includes("-X")
      );
    });
    expect(createCalls).toHaveLength(1);
  });

  it("does NOT create a second issue when syncing the same story again", async () => {
    // Seed the store with the issue already mapped.
    seedEnabled("owner/repo", { "1.1": 7 });

    invokeStub.mockImplementation((cmd: string) => {
      if (cmd === "run_gh") return Promise.resolve(ghOkResponse);
      if (cmd === "write_text_file") return Promise.resolve(undefined);
      return Promise.resolve(ghOkResponse);
    });

    const story = { epic: 1, story: 1, title: "Feature A" };
    await useTrackerStore.getState().syncStory("/project", story, "InReview");

    // No CREATE call (POST without -X) should have been made.
    const createCalls = invokeStub.mock.calls.filter((c: unknown[]) => {
      const cmd = c[0] as string;
      const args = c[1] as { args: string[] } | undefined;
      return (
        cmd === "run_gh" &&
        Array.isArray(args?.args) &&
        (args?.args[1] ?? "").includes("/issues") &&
        !args?.args.includes("-X") &&
        !(args?.args[1] ?? "").includes("/comments")
      );
    });
    expect(createCalls).toHaveLength(0);

    // A PATCH call (update state) should have been made.
    const patchCalls = invokeStub.mock.calls.filter((c: unknown[]) => {
      const cmd = c[0] as string;
      const args = c[1] as { args: string[] } | undefined;
      return cmd === "run_gh" && Array.isArray(args?.args) && args?.args.includes("-X");
    });
    expect(patchCalls).toHaveLength(1);
  });
});

describe("trackerStore.syncStory — race / per-story serialization", () => {
  it("fires EXACTLY ONE create when two syncs for the same unmapped story race", async () => {
    seedEnabled("owner/repo");

    let createCount = 0;
    invokeStub.mockImplementation((cmd: string, args: { args: string[] }) => {
      if (cmd === "run_gh") {
        const isCreate =
          Array.isArray(args?.args) &&
          args.args[1]?.includes("/issues") &&
          !args.args.includes("-X") &&
          !args.args[1]?.includes("/comments");
        if (isCreate) {
          createCount++;
          return Promise.resolve(ghCreateResponse(42));
        }
        // PATCH / comment — succeed silently.
        return Promise.resolve(ghOkResponse);
      }
      if (cmd === "write_text_file") return Promise.resolve(undefined);
      return Promise.resolve(ghOkResponse);
    });

    const story = { epic: 2, story: 3, title: "Race story" };
    const root = "/project-race";

    // Fire two calls without awaiting the first — the classic race.
    const p1 = useTrackerStore.getState().syncStory(root, story, "InProgress");
    const p2 = useTrackerStore.getState().syncStory(root, story, "InReview");
    await Promise.all([p1, p2]);

    // Exactly ONE create should have happened; the second took the edit path.
    expect(createCount).toBe(1);

    // The issue number written by the create is now persisted.
    expect(useTrackerStore.getState().issues["2.3"]).toBe(42);
  });

  it("does NOT serialize syncs across DIFFERENT stories (they proceed independently)", async () => {
    seedEnabled("owner/repo");

    const createEndpoints: string[] = [];
    invokeStub.mockImplementation((cmd: string, args: { args: string[] }) => {
      if (cmd === "run_gh") {
        const isCreate =
          Array.isArray(args?.args) &&
          args.args[1]?.includes("/issues") &&
          !args.args.includes("-X") &&
          !args.args[1]?.includes("/comments");
        if (isCreate) {
          // Record which story endpoint was created.
          createEndpoints.push(args.args[1] as string);
          return Promise.resolve(ghCreateResponse(99));
        }
        return Promise.resolve(ghOkResponse);
      }
      if (cmd === "write_text_file") return Promise.resolve(undefined);
      return Promise.resolve(ghOkResponse);
    });

    const storyA = { epic: 3, story: 1, title: "Story A" };
    const storyB = { epic: 3, story: 2, title: "Story B" };
    const root = "/project-parallel";

    // Both fire simultaneously — neither should block the other.
    await Promise.all([
      useTrackerStore.getState().syncStory(root, storyA, "InProgress"),
      useTrackerStore.getState().syncStory(root, storyB, "InProgress"),
    ]);

    // Both stories should have triggered a CREATE call (two separate endpoints).
    expect(createEndpoints).toHaveLength(2);
    expect(createEndpoints.some((e) => e.includes("repos/"))).toBe(true);
  });
});
