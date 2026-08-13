import { describe, it, expect, vi } from "vitest";

import type { TrackerStory, TrackerStatus } from "../../lib/integrations/mcpTracker";
import type { Status } from "../../lib/engine/status";
import type { NodeIo } from "./connectionsNode";
import {
  syncStoryNode,
  syncingSetStatus,
  type RunSyncAgentNode,
  type SyncStoryNodeDeps,
} from "./trackerSyncNode";

const root = "/project";
const trackerFilePath = `${root}/.cadre/mcp-tracker.json`;

const FAKE_ENV = {
  mcpConfigPath: "/project/.cadre/tracker.mcp.json",
  env: { API_TOKEN: "secret" },
  serverKey: "jira",
};

/** In-memory NodeIo fake — Map-backed filesystem (secrets unused here). Mirrors
 *  connectionsNode.test.ts's fakeIo(). readFile matches realNodeIo's ENOENT-only
 *  contract: absent path → null; any injected failure → throws. */
function fakeIo(initialFiles: Record<string, string> = {}): NodeIo & { files: Map<string, string> } {
  const files = new Map<string, string>(Object.entries(initialFiles));
  return {
    files,
    async getSecret() {
      return null;
    },
    async setSecret() {
      /* unused */
    },
    async deleteSecret() {
      /* unused */
    },
    async readFile(path: string) {
      return files.has(path) ? (files.get(path) as string) : null;
    },
    async writeFile(path: string, content: string) {
      files.set(path, content);
    },
  };
}

const story: TrackerStory = { epic: 1, story: 2, title: "Feature A" };

function makeDeps(overrides: Partial<SyncStoryNodeDeps> = {}): SyncStoryNodeDeps {
  return {
    resolveTrackerEnv: vi.fn().mockResolvedValue(FAKE_ENV),
    runSyncAgent: vi.fn(async () => JSON.stringify({ taskId: "T-DEFAULT" })) as RunSyncAgentNode,
    ...overrides,
  };
}

describe("syncStoryNode — status guard", () => {
  it("does NOT call runSyncAgent for Draft status", async () => {
    const io = fakeIo();
    const runSyncAgent = vi.fn() as unknown as RunSyncAgentNode;
    const deps = makeDeps({ runSyncAgent });

    await syncStoryNode(io, root, story, "Draft", undefined, deps);

    expect(runSyncAgent).not.toHaveBeenCalled();
    expect(io.files.has(trackerFilePath)).toBe(false);
  });
});

describe("syncStoryNode — no tracker resolvable", () => {
  it("does NOT call runSyncAgent when resolveTrackerEnv returns null, and writes nothing", async () => {
    const io = fakeIo();
    const runSyncAgent = vi.fn() as unknown as RunSyncAgentNode;
    const deps = makeDeps({
      resolveTrackerEnv: vi.fn().mockResolvedValue(null),
      runSyncAgent,
    });

    await syncStoryNode(io, root, story, "InProgress", undefined, deps);

    expect(runSyncAgent).not.toHaveBeenCalled();
    expect(io.files.has(trackerFilePath)).toBe(false);
  });
});

describe("syncStoryNode — create then update", () => {
  it("Done with no existing id: calls runSyncAgent and writes the id-map under <epic>.<story>", async () => {
    const io = fakeIo();
    let capturedPrompt = "";
    const runSyncAgent: RunSyncAgentNode = vi.fn(async (args) => {
      capturedPrompt = args.prompt;
      return JSON.stringify({ taskId: "T-1", url: "https://tracker/T-1" });
    });
    const deps = makeDeps({ runSyncAgent });

    await syncStoryNode(io, root, story, "Done", "npm test", deps);

    expect(runSyncAgent).toHaveBeenCalledTimes(1);
    expect(capturedPrompt.toLowerCase()).toContain("create");
    expect(capturedPrompt).not.toContain("T-1");

    const written = io.files.get(trackerFilePath);
    expect(written).toBeDefined();
    const parsed = JSON.parse(written!);
    expect(parsed.tasks["1.2"]).toEqual({ taskId: "T-1", url: "https://tracker/T-1" });
  });

  it("second Done sync for the same story: prompt carries the existing id, one entry (no dup key)", async () => {
    const io = fakeIo({
      [trackerFilePath]: JSON.stringify({ version: 1, connectionId: "jira", tasks: { "1.2": { taskId: "T-1" } } }),
    });
    let capturedPrompt = "";
    const runSyncAgent: RunSyncAgentNode = vi.fn(async (args) => {
      capturedPrompt = args.prompt;
      return JSON.stringify({ taskId: "T-1" });
    });
    const deps = makeDeps({ runSyncAgent });

    await syncStoryNode(io, root, story, "Done", "npm test", deps);

    expect(capturedPrompt).toContain("T-1");
    expect(capturedPrompt.toLowerCase()).toContain("update");

    const written = JSON.parse(io.files.get(trackerFilePath)!);
    expect(Object.keys(written.tasks)).toEqual(["1.2"]);
    expect(written.tasks["1.2"].taskId).toBe("T-1");
  });
});

describe("syncStoryNode — parent-ticket routing (linked epic)", () => {
  const linkedFile = JSON.stringify({
    version: 1,
    connectionId: "jira",
    tasks: {},
    epics: { "1": { ticketId: "TICK-1", url: "https://tracker/TICK-1" } },
  });

  it("linked epic + mixed epicStatuses: prompt carries the ticketId + aggregate status, no tasks[storyKey] write", async () => {
    const io = fakeIo({ [trackerFilePath]: linkedFile });
    let capturedPrompt = "";
    const runSyncAgent: RunSyncAgentNode = vi.fn(async (args) => {
      capturedPrompt = args.prompt;
      return JSON.stringify({ taskId: "TICK-1", url: "https://tracker/TICK-1" });
    });
    const deps = makeDeps({ runSyncAgent });
    const epicStatuses: { epic: number; story: number; status: TrackerStatus }[] = [
      { epic: 1, story: 1, status: "Done" },
      { epic: 1, story: 2, status: "InProgress" },
    ];

    await syncStoryNode(io, root, story, "InProgress", "npm test", deps, epicStatuses);

    expect(runSyncAgent).toHaveBeenCalledTimes(1);
    expect(capturedPrompt).toContain("TICK-1");
    expect(capturedPrompt).toContain("InProgress");

    // No per-story write at all — the parent ticket is the record.
    expect(io.files.get(trackerFilePath)).toBe(linkedFile);
  });

  it("aggregate status is null (all Draft/Approved): the agent is NOT called and nothing is written", async () => {
    const io = fakeIo({ [trackerFilePath]: linkedFile });
    const runSyncAgent = vi.fn() as unknown as RunSyncAgentNode;
    const deps = makeDeps({ runSyncAgent });
    const epicStatuses: { epic: number; story: number; status: TrackerStatus }[] = [
      { epic: 1, story: 1, status: "Draft" },
      { epic: 1, story: 2, status: "Approved" },
    ];

    await syncStoryNode(io, root, story, "InProgress", undefined, deps, epicStatuses);

    expect(runSyncAgent).not.toHaveBeenCalled();
    expect(io.files.get(trackerFilePath)).toBe(linkedFile);
  });

  it("REGRESSION GUARD — unlinked epic: per-story path runs unchanged even when epicStatuses is supplied", async () => {
    const io = fakeIo(); // no epics entry at all
    let capturedPrompt = "";
    const runSyncAgent: RunSyncAgentNode = vi.fn(async (args) => {
      capturedPrompt = args.prompt;
      return JSON.stringify({ taskId: "T-1", url: "https://tracker/T-1" });
    });
    const deps = makeDeps({ runSyncAgent });
    const epicStatuses: { epic: number; story: number; status: TrackerStatus }[] = [
      { epic: 1, story: 2, status: "Done" },
    ];

    await syncStoryNode(io, root, story, "Done", "npm test", deps, epicStatuses);

    expect(runSyncAgent).toHaveBeenCalledTimes(1);
    expect(capturedPrompt.toLowerCase()).toContain("create");

    const written = JSON.parse(io.files.get(trackerFilePath)!);
    expect(written.tasks["1.2"]).toEqual({ taskId: "T-1", url: "https://tracker/T-1" });
  });

  it("epicStatuses omitted (back-compat): falls back to the per-story path even for a linked epic", async () => {
    const io = fakeIo({ [trackerFilePath]: linkedFile });
    let capturedPrompt = "";
    const runSyncAgent: RunSyncAgentNode = vi.fn(async (args) => {
      capturedPrompt = args.prompt;
      return JSON.stringify({ taskId: "T-1" });
    });
    const deps = makeDeps({ runSyncAgent });

    await syncStoryNode(io, root, story, "Done", undefined, deps);

    expect(runSyncAgent).toHaveBeenCalledTimes(1);
    expect(capturedPrompt.toLowerCase()).toContain("create");

    const written = JSON.parse(io.files.get(trackerFilePath)!);
    expect(written.tasks["1.2"]).toEqual({ taskId: "T-1" });
  });
});

describe("syncStoryNode — transient read error never wipes the id-map (I1)", () => {
  it("readFile THROWS (non-ENOENT) while the file has prior ids: no write, warning logged, no throw, prior file preserved", async () => {
    const existingContent = JSON.stringify({
      version: 1,
      connectionId: "jira",
      tasks: { "9.9": { taskId: "T-OTHER" } },
    });
    const io = fakeIo({ [trackerFilePath]: existingContent });
    // Simulate a transient/permission read failure — NOT the "absent file" case.
    io.readFile = vi.fn().mockRejectedValue(new Error("EACCES: permission denied"));

    const runSyncAgent = vi.fn() as unknown as RunSyncAgentNode;
    const deps = makeDeps({ runSyncAgent });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(syncStoryNode(io, root, story, "Done", undefined, deps)).resolves.toBeUndefined();

    expect(runSyncAgent).not.toHaveBeenCalled();
    expect(io.files.has(trackerFilePath)).toBe(true);
    expect(io.files.get(trackerFilePath)).toBe(existingContent);
    expect(errSpy).toHaveBeenCalled();

    errSpy.mockRestore();
  });

  it("a present-but-malformed tracker file also aborts (no write) rather than being silently overwritten", async () => {
    const io = fakeIo({ [trackerFilePath]: "{not valid json" });
    const runSyncAgent = vi.fn() as unknown as RunSyncAgentNode;
    const deps = makeDeps({ runSyncAgent });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(syncStoryNode(io, root, story, "Done", undefined, deps)).resolves.toBeUndefined();

    expect(runSyncAgent).not.toHaveBeenCalled();
    expect(io.files.get(trackerFilePath)).toBe("{not valid json");
    expect(errSpy).toHaveBeenCalled();

    errSpy.mockRestore();
  });
});

describe("syncingSetStatus — syncs only real engine transitions", () => {
  it("runs the engine write FIRST, then syncs the SAME transition", async () => {
    const order: string[] = [];
    const base = vi.fn(async () => {
      order.push("base");
    });
    const sync = vi.fn(async () => {
      order.push("sync");
    });
    const wrapped = syncingSetStatus(base, sync);

    await wrapped(1, 2, "InProgress");

    expect(base).toHaveBeenCalledWith(1, 2, "InProgress");
    expect(sync).toHaveBeenCalledWith(1, 2, "InProgress");
    expect(order).toEqual(["base", "sync"]);
  });

  it("does NOT sync a transition that never fires (engine throws BEFORE setStatus) — no stuck InProgress", async () => {
    const base = vi.fn(async () => {});
    const sync = vi.fn(async () => {});
    const wrapped = syncingSetStatus(base, sync);

    // Model runApprovedStory's per-repo verify gate: it rejects BEFORE the
    // engine ever calls setStatus, so the wrapper is simply never invoked.
    const engineThatThrowsBeforeTransition = async (
      _setStatus: (e: number, s: number, status: Status) => Promise<void>
    ): Promise<void> => {
      throw new Error("PLAN gate: no frozen verify command for repo");
    };

    await expect(engineThatThrowsBeforeTransition(wrapped)).rejects.toThrow();

    expect(base).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
  });

  it("if the authoritative engine write throws, the sync does NOT run (never reports an unwritten status)", async () => {
    const base = vi.fn().mockRejectedValue(new Error("disk full"));
    const sync = vi.fn(async () => {});
    const wrapped = syncingSetStatus(base, sync);

    await expect(wrapped(1, 2, "Done")).rejects.toThrow("disk full");

    expect(sync).not.toHaveBeenCalled();
  });
});

describe("syncStoryNode — agent failure never throws or corrupts state", () => {
  it("a rejecting runSyncAgent: no throw, no write, warning logged", async () => {
    const io = fakeIo();
    const runSyncAgent: RunSyncAgentNode = vi.fn().mockRejectedValue(new Error("agent crashed"));
    const deps = makeDeps({ runSyncAgent });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(syncStoryNode(io, root, story, "Done", undefined, deps)).resolves.toBeUndefined();

    expect(runSyncAgent).toHaveBeenCalledTimes(1);
    expect(io.files.has(trackerFilePath)).toBe(false);
    expect(errSpy).toHaveBeenCalled();

    errSpy.mockRestore();
  });

  it("a HUNG agent that times out (SIGKILL-style rejection): no throw, no write, prior id-map preserved", async () => {
    // realRunSyncAgentNode caps the child with `timeout`/`killSignal:"SIGKILL"`;
    // on timeout execFile rejects with an error carrying .killed/.signal. Model
    // that rejection to prove syncStoryNode's outer try/catch turns a timeout
    // into a logged warning — no hang, no corruption of the shared id-map.
    const existingContent = JSON.stringify({
      version: 1,
      connectionId: "jira",
      tasks: { "9.9": { taskId: "T-OTHER" } },
    });
    const io = fakeIo({ [trackerFilePath]: existingContent });
    const timeoutErr = Object.assign(new Error("Command failed: claude ... "), {
      killed: true,
      signal: "SIGKILL",
      code: null,
    });
    const runSyncAgent: RunSyncAgentNode = vi.fn().mockRejectedValue(timeoutErr);
    const deps = makeDeps({ runSyncAgent });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(syncStoryNode(io, root, story, "Done", undefined, deps)).resolves.toBeUndefined();

    expect(runSyncAgent).toHaveBeenCalledTimes(1);
    // Prior id-map is untouched — the timeout wrote nothing.
    expect(io.files.get(trackerFilePath)).toBe(existingContent);
    expect(errSpy).toHaveBeenCalled();

    errSpy.mockRestore();
  });
});
