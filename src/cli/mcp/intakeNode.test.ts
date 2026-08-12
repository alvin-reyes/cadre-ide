import { describe, it, expect, vi } from "vitest";

import type { NodeIo } from "./connectionsNode";
import { fetchTicketNode, type RunFetchAgentNode } from "./intakeNode";

const root = "/project";

const FAKE_ENV = {
  mcpConfigPath: "/project/.cadre/tracker.mcp.json",
  env: { API_TOKEN: "secret" },
  serverKey: "jira",
};

/** In-memory NodeIo fake — Map-backed filesystem (secrets unused here).
 *  Mirrors trackerSyncNode.test.ts's fakeIo(). */
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

describe("fetchTicketNode — happy path", () => {
  it("resolves a valid ticket from the fetch agent's JSON reply", async () => {
    const io = fakeIo();
    const resolveTrackerEnv = vi.fn().mockResolvedValue(FAKE_ENV);
    const runFetchAgent: RunFetchAgentNode = vi.fn(async () =>
      JSON.stringify({
        id: "TCK-1",
        title: "Fix the thing",
        description: "details here",
        url: "https://tracker/TCK-1",
      })
    );

    const ticket = await fetchTicketNode(io, root, "TCK-1", { resolveTrackerEnv, runFetchAgent });

    expect(ticket).toEqual({
      id: "TCK-1",
      title: "Fix the thing",
      description: "details here",
      url: "https://tracker/TCK-1",
    });
    expect(resolveTrackerEnv).toHaveBeenCalledWith(io, root);
    expect(runFetchAgent).toHaveBeenCalledTimes(1);
    const call = (runFetchAgent as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.mcpConfigPath).toBe(FAKE_ENV.mcpConfigPath);
    expect(call.env).toEqual(FAKE_ENV.env);
    expect(call.serverKey).toBe("jira");
    expect(call.cwd).toBe(root);
    expect(call.prompt).toContain("TCK-1");
  });
});

describe("fetchTicketNode — no tracker connection", () => {
  it("THROWS loudly when resolveTrackerEnv resolves null, without ever calling the fetch agent", async () => {
    const io = fakeIo();
    const resolveTrackerEnv = vi.fn().mockResolvedValue(null);
    const runFetchAgent: RunFetchAgentNode = vi.fn();

    await expect(fetchTicketNode(io, root, "TCK-1", { resolveTrackerEnv, runFetchAgent })).rejects.toThrow(
      /tracker/i
    );
    expect(runFetchAgent).not.toHaveBeenCalled();
  });
});

describe("fetchTicketNode — fetch agent failure", () => {
  it("THROWS when the fetch agent rejects (e.g. a timeout-style SIGKILL rejection)", async () => {
    const io = fakeIo();
    const resolveTrackerEnv = vi.fn().mockResolvedValue(FAKE_ENV);
    const timeoutErr = Object.assign(new Error("Command failed: claude ..."), {
      killed: true,
      signal: "SIGKILL",
      code: null,
    });
    const runFetchAgent: RunFetchAgentNode = vi.fn().mockRejectedValue(timeoutErr);

    await expect(
      fetchTicketNode(io, root, "TCK-1", { resolveTrackerEnv, runFetchAgent })
    ).rejects.toThrow();
  });
});

describe("fetchTicketNode — parse failure", () => {
  it("THROWS when the agent's reply doesn't parse into a valid ticket", async () => {
    const io = fakeIo();
    const resolveTrackerEnv = vi.fn().mockResolvedValue(FAKE_ENV);
    const runFetchAgent: RunFetchAgentNode = vi.fn(async () => "not json, sorry, no ticket here");

    await expect(
      fetchTicketNode(io, root, "TCK-1", { resolveTrackerEnv, runFetchAgent })
    ).rejects.toThrow();
  });
});
