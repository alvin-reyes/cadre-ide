import { describe, it, expect, vi } from "vitest";
import { startSubagent } from "./runBatch";

// waitForExit resolves on a later macrotask — a real process never exits in the
// same microtask it was spawned. This lets a test observe "running" (set right
// after the awaited spawn) BEFORE the detached exit-watch drives done/failed.
const exitAfterTick = (exitCode: number) =>
  vi.fn(() => new Promise<{ exitCode: number }>((r) => setTimeout(() => r({ exitCode }), 0)));

const baseDeps = (over = {}) => ({
  runGit: vi.fn().mockResolvedValue(undefined),
  runGitQuery: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "" }),
  spawnAgent: vi.fn().mockResolvedValue(42),
  waitForExit: exitAfterTick(0),
  ...over,
});

describe("startSubagent", () => {
  it("spawns → running synchronously, done after exit resolves", async () => {
    const statuses: string[] = [];
    const deps = baseDeps();
    const pty = await startSubagent(deps as any, { repoPath: "/r", worktreeRoot: "/r", id: "a", prompt: "x", onStatus: (s) => statuses.push(s) });
    expect(pty).toBe(42);
    expect(statuses).toEqual(["running"]); // "running" set right after the awaited spawn
    await new Promise((r) => setTimeout(r, 0)); // flush the detached exit-watch
    expect(statuses).toEqual(["running", "done"]);
    expect(deps.waitForExit).toHaveBeenCalledWith(42);
  });
  it("failed after non-zero exit resolves", async () => {
    const statuses: string[] = [];
    const deps = baseDeps({ waitForExit: exitAfterTick(1) });
    const pty = await startSubagent(deps as any, { repoPath: "/r", worktreeRoot: "/r", id: "a", prompt: "x", onStatus: (s) => statuses.push(s) });
    expect(pty).toBe(42);
    expect(statuses).toEqual(["running"]);
    await new Promise((r) => setTimeout(r, 0)); // flush the detached exit-watch
    expect(statuses).toEqual(["running", "failed"]);
  });
  it("failed on spawn throw, never running, returns null", async () => {
    const statuses: string[] = [];
    const deps = baseDeps({ spawnAgent: vi.fn().mockRejectedValue(new Error("no worktree")) });
    const pty = await startSubagent(deps as any, { repoPath: "/r", worktreeRoot: "/r", id: "a", prompt: "x", onStatus: (s) => statuses.push(s) });
    expect(pty).toBeNull();
    expect(statuses).toEqual(["failed"]);
  });
});
