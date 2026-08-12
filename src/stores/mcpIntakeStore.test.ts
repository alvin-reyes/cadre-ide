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
