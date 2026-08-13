import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — @tauri-apps/api/core (invoke) and reportError, set up before the
// store under test is imported. Pattern mirrors mcpTrackerStore.test.ts.
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

import { useMcpIntakeStore, type RunFetchAgent } from "./mcpIntakeStore";
import { useConnectionsStore } from "./connectionsStore";

const FAKE_ENV = {
  mcpConfigPath: "/project/.cadre/tracker.mcp.json",
  env: { API_TOKEN: "super-secret-value" },
  serverKey: "jira",
};

/** In-memory fake filesystem keyed by path, backing the invoke mock for
 *  read_file/write_text_file — mirrors mcpTrackerStore.test.ts's makeFsStub
 *  so the real Tauri ENOENT message shape is exercised. */
function makeFsStub(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
  invokeStub.mockImplementation((cmd: string, args: { path?: string; content?: string }) => {
    if (cmd === "read_file") {
      const content = files.get(args.path!);
      if (content === undefined) {
        return Promise.reject(new Error(`Failed to read ${args.path}: No such file or directory (os error 2)`));
      }
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

beforeEach(() => {
  invokeStub.mockReset();
  reportErrorStub.mockReset();
  vi.spyOn(useConnectionsStore, "getState").mockReturnValue({
    resolveTrackerEnv: vi.fn().mockResolvedValue(FAKE_ENV),
  } as unknown as ReturnType<typeof useConnectionsStore.getState>);
  // Reset the runFetchAgent test seam to a default no-op fake before each test.
  useMcpIntakeStore.getState().__setRunFetchAgent(async () => JSON.stringify({ id: "T-DEFAULT", title: "Default" }));
});

describe("mcpIntakeStore.fetchTicket — happy path", () => {
  it("returns the parsed ticket when the agent returns valid ticket JSON, and importing flips back to false", async () => {
    const fake: RunFetchAgent = vi.fn(async () =>
      JSON.stringify({ id: "TCK-42", title: "Add login", description: "users log in", acceptanceCriteria: "email+pw" }),
    );
    useMcpIntakeStore.getState().__setRunFetchAgent(fake);

    const p = useMcpIntakeStore.getState().fetchTicket("/project", "TCK-42");
    // importing should be true while the fetch is in flight.
    expect(useMcpIntakeStore.getState().importing).toBe(true);

    const ticket = await p;

    expect(ticket).toEqual({
      id: "TCK-42",
      title: "Add login",
      description: "users log in",
      acceptanceCriteria: "email+pw",
    });
    expect(fake).toHaveBeenCalledTimes(1);
    expect(useMcpIntakeStore.getState().importing).toBe(false);
    expect(reportErrorStub).not.toHaveBeenCalled();
  });

  it("passes the tracker's mcpConfigPath/env/serverKey/cwd through to the agent", async () => {
    let captured: Parameters<RunFetchAgent>[0] | undefined;
    const fake: RunFetchAgent = vi.fn(async (args) => {
      captured = args;
      return JSON.stringify({ id: "TCK-1", title: "T" });
    });
    useMcpIntakeStore.getState().__setRunFetchAgent(fake);

    await useMcpIntakeStore.getState().fetchTicket("/project", "TCK-1");

    expect(captured?.mcpConfigPath).toBe(FAKE_ENV.mcpConfigPath);
    expect(captured?.env).toEqual(FAKE_ENV.env);
    expect(captured?.serverKey).toBe(FAKE_ENV.serverKey);
    expect(captured?.cwd).toBe("/project");
    expect(captured?.prompt).toContain("TCK-1");
  });
});

describe("mcpIntakeStore.fetchTicket — no tracker resolvable", () => {
  it("returns null and reportErrors without calling runFetchAgent when resolveTrackerEnv returns null", async () => {
    vi.spyOn(useConnectionsStore, "getState").mockReturnValue({
      resolveTrackerEnv: vi.fn().mockResolvedValue(null),
    } as unknown as ReturnType<typeof useConnectionsStore.getState>);

    const fake = vi.fn<RunFetchAgent>();
    useMcpIntakeStore.getState().__setRunFetchAgent(fake);

    const ticket = await useMcpIntakeStore.getState().fetchTicket("/project", "TCK-1");

    expect(ticket).toBeNull();
    expect(fake).not.toHaveBeenCalled();
    expect(reportErrorStub).toHaveBeenCalledWith("intake: no tracker connection designated", expect.any(String));
    expect(useMcpIntakeStore.getState().importing).toBe(false);
  });
});

describe("mcpIntakeStore.fetchTicket — failure is swallowed, never throws", () => {
  it("returns null and reportErrors when the agent rejects", async () => {
    const fake: RunFetchAgent = vi.fn(async () => {
      throw new Error("agent boom");
    });
    useMcpIntakeStore.getState().__setRunFetchAgent(fake);

    await expect(useMcpIntakeStore.getState().fetchTicket("/project", "TCK-1")).resolves.toBeNull();

    expect(reportErrorStub).toHaveBeenCalledWith("intake: fetch failed", expect.any(Error));
    expect(useMcpIntakeStore.getState().importing).toBe(false);
  });

  it("returns null and reportErrors when the agent returns garbage (no valid JSON ticket)", async () => {
    const fake: RunFetchAgent = vi.fn(async () => "not json at all");
    useMcpIntakeStore.getState().__setRunFetchAgent(fake);

    await expect(useMcpIntakeStore.getState().fetchTicket("/project", "TCK-1")).resolves.toBeNull();

    expect(reportErrorStub).toHaveBeenCalledWith("intake: fetch failed", expect.any(Error));
    expect(useMcpIntakeStore.getState().importing).toBe(false);
  });

  it("returns null and reportErrors when the agent returns JSON missing required fields", async () => {
    const fake: RunFetchAgent = vi.fn(async () => JSON.stringify({ id: "TCK-1" })); // missing title
    useMcpIntakeStore.getState().__setRunFetchAgent(fake);

    await expect(useMcpIntakeStore.getState().fetchTicket("/project", "TCK-1")).resolves.toBeNull();

    expect(reportErrorStub).toHaveBeenCalledWith("intake: fetch failed", expect.any(Error));
  });
});

describe("mcpIntakeStore.fetchTicket — a hung agent is bounded by a timeout", () => {
  it("fails-closed when the agent never returns: resolves null, reportErrors, and resets importing", async () => {
    vi.useFakeTimers();
    try {
      // An agent that never resolves — models a wedged `claude`/MCP server.
      useMcpIntakeStore.getState().__setRunFetchAgent(() => new Promise<string>(() => {}));

      const p = useMcpIntakeStore.getState().fetchTicket("/project", "TCK-1");
      // Button is spinning while the fetch is in flight.
      expect(useMcpIntakeStore.getState().importing).toBe(true);

      // Advance past the timeout — the race should reject and unwedge the flow.
      await vi.advanceTimersByTimeAsync(120_000);

      await expect(p).resolves.toBeNull();
      expect(reportErrorStub).toHaveBeenCalledWith("intake: fetch failed", expect.any(Error));
      expect(useMcpIntakeStore.getState().importing).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("mcpIntakeStore.recordEpicLinkFor — writes the epic↔ticket link (Task 2)", () => {
  it("genuinely-missing file: creates an empty tracker file owned by the resolved serverKey, then records the epic link", async () => {
    const files = makeFsStub();

    await useMcpIntakeStore.getState().recordEpicLinkFor("/project", 1, { ticketId: "TCK-42", url: "https://tracker.example/TCK-42" });

    expect(reportErrorStub).not.toHaveBeenCalled();
    const written = files.get("/project/.cadre/mcp-tracker.json");
    expect(written).toBeDefined();
    const parsed = JSON.parse(written!);
    expect(parsed.connectionId).toBe(FAKE_ENV.serverKey);
    expect(parsed.epics["1"]).toEqual({ ticketId: "TCK-42", url: "https://tracker.example/TCK-42" });
    expect(parsed.tasks).toEqual({});
  });

  it("existing file: preserves prior tasks/epics and adds the new epic link, without needing resolveTrackerEnv", async () => {
    const existingContent = JSON.stringify({
      version: 1,
      connectionId: "jira",
      tasks: { "2.1": { taskId: "T-OTHER" } },
      epics: { "2": { ticketId: "EPIC-OTHER" } },
    });
    const files = makeFsStub({ "/project/.cadre/mcp-tracker.json": existingContent });

    await useMcpIntakeStore.getState().recordEpicLinkFor("/project", 1, { ticketId: "TCK-1" });

    const written = files.get("/project/.cadre/mcp-tracker.json");
    const parsed = JSON.parse(written!);
    expect(parsed.tasks["2.1"].taskId).toBe("T-OTHER");
    expect(parsed.epics["2"].ticketId).toBe("EPIC-OTHER");
    expect(parsed.epics["1"]).toEqual({ ticketId: "TCK-1" });
  });

  it("a NON-not-found read failure aborts: reportErrors and does NOT write (I1)", async () => {
    const files = makeFsStub();
    invokeStub.mockImplementation((cmd: string, args: { path?: string; content?: string }) => {
      if (cmd === "read_file") {
        return Promise.reject(new Error(`Failed to read ${args.path}: permission denied`));
      }
      if (cmd === "write_text_file") {
        files.set(args.path!, args.content!);
        return Promise.resolve(undefined);
      }
      return Promise.reject(new Error(`unexpected invoke: ${cmd}`));
    });

    await expect(
      useMcpIntakeStore.getState().recordEpicLinkFor("/project", 1, { ticketId: "TCK-1" }),
    ).resolves.toBeUndefined();

    expect(reportErrorStub).toHaveBeenCalledWith("intake: record epic link", expect.any(Error));
    const writes = invokeStub.mock.calls.filter((c: unknown[]) => c[0] === "write_text_file");
    expect(writes).toHaveLength(0);
  });

  it("a present-but-malformed tracker file aborts: reportErrors and does NOT write", async () => {
    const files = makeFsStub({ "/project/.cadre/mcp-tracker.json": "{not valid json" });

    await expect(
      useMcpIntakeStore.getState().recordEpicLinkFor("/project", 1, { ticketId: "TCK-1" }),
    ).resolves.toBeUndefined();

    expect(reportErrorStub).toHaveBeenCalledWith("intake: record epic link", expect.any(Error));
    const writes = invokeStub.mock.calls.filter((c: unknown[]) => c[0] === "write_text_file");
    expect(writes).toHaveLength(0);
    expect(files.get("/project/.cadre/mcp-tracker.json")).toBe("{not valid json");
  });

  it("never throws even when write_text_file rejects", async () => {
    invokeStub.mockImplementation((cmd: string, args: { path?: string }) => {
      if (cmd === "read_file") {
        return Promise.reject(new Error(`Failed to read ${args.path}: No such file or directory (os error 2)`));
      }
      if (cmd === "write_text_file") {
        return Promise.reject(new Error("disk full"));
      }
      return Promise.reject(new Error(`unexpected invoke: ${cmd}`));
    });

    await expect(
      useMcpIntakeStore.getState().recordEpicLinkFor("/project", 1, { ticketId: "TCK-1" }),
    ).resolves.toBeUndefined();

    expect(reportErrorStub).toHaveBeenCalledWith("intake: record epic link", expect.any(Error));
  });
});

describe("mcpIntakeStore.fetchTicket — secrets never leak into the prompt/args", () => {
  it("the spawned prompt never contains the secret value — secrets travel only via env", async () => {
    let capturedPrompt = "";
    const fake: RunFetchAgent = vi.fn(async (args) => {
      capturedPrompt = args.prompt;
      return JSON.stringify({ id: "TCK-1", title: "T" });
    });
    useMcpIntakeStore.getState().__setRunFetchAgent(fake);

    await useMcpIntakeStore.getState().fetchTicket("/project", "TCK-1");

    expect(capturedPrompt).not.toContain(FAKE_ENV.env.API_TOKEN);
  });
});
