import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TrackerStory } from "../lib/integrations/mcpTracker";

// ---------------------------------------------------------------------------
// Mocks — @tauri-apps/api/core (invoke) and reportError, set up before the
// store under test is imported. Pattern mirrors trackerStore.test.ts.
// ---------------------------------------------------------------------------

const { invokeStub, reportErrorStub } = vi.hoisted(() => ({
  invokeStub: vi.fn(),
  reportErrorStub: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeStub,
  Channel: class {
    onmessage: ((evt: unknown) => void) | null = null;
  },
}));

vi.mock("../lib/reportError", () => ({
  reportError: reportErrorStub,
}));

import { useMcpTrackerStore, type RunSyncAgent } from "./mcpTrackerStore";
import { useConnectionsStore } from "./connectionsStore";

const FAKE_ENV = {
  mcpConfigPath: "/project/.cadre/tracker.mcp.json",
  env: { API_TOKEN: "secret" },
  serverKey: "jira",
};

/** In-memory fake filesystem keyed by path, backing the invoke mock. */
function makeFsStub(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
  invokeStub.mockImplementation((cmd: string, args: { path?: string; content?: string }) => {
    if (cmd === "read_file") {
      const content = files.get(args.path!);
      if (content === undefined) return Promise.reject(new Error("not found"));
      return Promise.resolve(content);
    }
    if (cmd === "write_text_file") {
      files.set(args.path!, args.content!);
      return Promise.resolve(undefined);
    }
    return Promise.reject(new Error(`unexpected invoke: ${cmd}`));
  });
  return files;
}

const story: TrackerStory = { epic: 1, story: 2, title: "Feature A" };

beforeEach(() => {
  invokeStub.mockReset();
  reportErrorStub.mockReset();
  makeFsStub();
  vi.spyOn(useConnectionsStore, "getState").mockReturnValue({
    resolveTrackerEnv: vi.fn().mockResolvedValue(FAKE_ENV),
  } as unknown as ReturnType<typeof useConnectionsStore.getState>);
  // Reset the runSyncAgent test seam to a default no-op fake before each test.
  useMcpTrackerStore.getState().__setRunSyncAgent(async () => JSON.stringify({ taskId: "T-DEFAULT" }));
});

describe("mcpTrackerStore.syncStory — status guard", () => {
  it("does NOT call runSyncAgent for Draft status", async () => {
    const fake = vi.fn<RunSyncAgent>();
    useMcpTrackerStore.getState().__setRunSyncAgent(fake);

    await useMcpTrackerStore.getState().syncStory("/project", story, "Draft");

    expect(fake).not.toHaveBeenCalled();
    expect(invokeStub).not.toHaveBeenCalled();
  });
});

describe("mcpTrackerStore.syncStory — no tracker resolvable", () => {
  it("does NOT call runSyncAgent when resolveTrackerEnv returns null", async () => {
    vi.spyOn(useConnectionsStore, "getState").mockReturnValue({
      resolveTrackerEnv: vi.fn().mockResolvedValue(null),
    } as unknown as ReturnType<typeof useConnectionsStore.getState>);

    const fake = vi.fn<RunSyncAgent>();
    useMcpTrackerStore.getState().__setRunSyncAgent(fake);

    await useMcpTrackerStore.getState().syncStory("/project", story, "InProgress");

    expect(fake).not.toHaveBeenCalled();
    // No write_text_file call for mcp-tracker.json (read_file may or may not
    // have been attempted, but nothing should be written).
    const writes = invokeStub.mock.calls.filter((c: unknown[]) => c[0] === "write_text_file");
    expect(writes).toHaveLength(0);
  });
});

describe("mcpTrackerStore.syncStory — create then update", () => {
  it("creates a task on first sync (no existing id) and persists the taskId", async () => {
    const files = makeFsStub();
    let capturedPrompt = "";
    const fake: RunSyncAgent = vi.fn(async (args) => {
      capturedPrompt = args.prompt;
      return JSON.stringify({ taskId: "T-1" });
    });
    useMcpTrackerStore.getState().__setRunSyncAgent(fake);

    await useMcpTrackerStore.getState().syncStory("/project", story, "Done");

    expect(fake).toHaveBeenCalledTimes(1);
    // Prompt should indicate a create (no prior existing id referenced).
    expect(capturedPrompt.toLowerCase()).toContain("create");
    expect(capturedPrompt).not.toContain("T-1");

    const written = files.get("/project/.cadre/mcp-tracker.json");
    expect(written).toBeDefined();
    const parsed = JSON.parse(written!);
    expect(parsed.tasks["1.2"].taskId).toBe("T-1");
  });

  it("second sync for the same story sends the existing id (update path) and does not duplicate the key", async () => {
    const files = makeFsStub();

    const fakeCreate: RunSyncAgent = vi.fn(async () => JSON.stringify({ taskId: "T-1" }));
    useMcpTrackerStore.getState().__setRunSyncAgent(fakeCreate);
    await useMcpTrackerStore.getState().syncStory("/project", story, "Done");

    let capturedPrompt = "";
    const fakeUpdate: RunSyncAgent = vi.fn(async (args) => {
      capturedPrompt = args.prompt;
      return JSON.stringify({ taskId: "T-1", url: "https://tracker.example/T-1" });
    });
    useMcpTrackerStore.getState().__setRunSyncAgent(fakeUpdate);
    await useMcpTrackerStore.getState().syncStory("/project", story, "InReview");

    expect(fakeUpdate).toHaveBeenCalledTimes(1);
    expect(capturedPrompt).toContain("T-1");

    const written = files.get("/project/.cadre/mcp-tracker.json");
    const parsed = JSON.parse(written!);
    expect(Object.keys(parsed.tasks)).toEqual(["1.2"]);
    expect(parsed.tasks["1.2"].taskId).toBe("T-1");
    expect(parsed.tasks["1.2"].url).toBe("https://tracker.example/T-1");
  });
});

describe("mcpTrackerStore.syncStory — failure is swallowed", () => {
  it("reports the error and resolves (no throw) when runSyncAgent rejects, without corrupting the tracker file", async () => {
    const files = makeFsStub();
    const fake: RunSyncAgent = vi.fn(async () => {
      throw new Error("agent boom");
    });
    useMcpTrackerStore.getState().__setRunSyncAgent(fake);

    await expect(useMcpTrackerStore.getState().syncStory("/project", story, "Done")).resolves.toBeUndefined();

    expect(reportErrorStub).toHaveBeenCalledWith("mcp tracker: sync", expect.any(Error));
    // Nothing should have been written for this story.
    expect(files.get("/project/.cadre/mcp-tracker.json")).toBeUndefined();
  });

  it("reports the error when parseSyncResult fails on malformed agent output", async () => {
    makeFsStub();
    const fake: RunSyncAgent = vi.fn(async () => "not json at all");
    useMcpTrackerStore.getState().__setRunSyncAgent(fake);

    await expect(useMcpTrackerStore.getState().syncStory("/project", story, "Done")).resolves.toBeUndefined();

    expect(reportErrorStub).toHaveBeenCalledWith("mcp tracker: sync", expect.any(Error));
  });
});

describe("mcpTrackerStore.syncStory — serialization across concurrent calls", () => {
  it("the second overlapping call sees the taskId the first call wrote (no duplicate create)", async () => {
    const files = makeFsStub();

    // First call's runSyncAgent is a controlled deferred — it doesn't resolve
    // until we let it, so the second call's `.then` chain link must queue
    // behind it rather than racing ahead.
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const prompts: string[] = [];
    let callCount = 0;
    const fake: RunSyncAgent = vi.fn(async (args) => {
      callCount += 1;
      prompts.push(args.prompt);
      if (callCount === 1) {
        await firstGate;
        return JSON.stringify({ taskId: "T-RACE" });
      }
      // Second call must run AFTER the first has written T-RACE.
      return JSON.stringify({ taskId: "T-RACE" });
    });
    useMcpTrackerStore.getState().__setRunSyncAgent(fake);

    const p1 = useMcpTrackerStore.getState().syncStory("/project", story, "Done");
    const p2 = useMcpTrackerStore.getState().syncStory("/project", story, "InReview");

    // Let the first agent call proceed once both syncs are in flight.
    releaseFirst();
    await Promise.all([p1, p2]);

    expect(callCount).toBe(2);
    // The second call's prompt must reference the id the first call created.
    expect(prompts[1]).toContain("T-RACE");

    const written = files.get("/project/.cadre/mcp-tracker.json");
    const parsed = JSON.parse(written!);
    expect(Object.keys(parsed.tasks)).toEqual(["1.2"]);
    expect(parsed.tasks["1.2"].taskId).toBe("T-RACE");
  });
});
