import { describe, it, expect, vi } from "vitest";
import { runSubagent } from "./runBatch";

const baseDeps = (over = {}) => ({
  runGit: vi.fn().mockResolvedValue(undefined),
  runGitQuery: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "" }),
  spawnAgent: vi.fn().mockResolvedValue(42),
  waitForExit: vi.fn().mockResolvedValue({ exitCode: 0 }),
  ...over,
});

describe("runSubagent", () => {
  it("spawns → running, then done on clean exit", async () => {
    const statuses: string[] = [];
    const deps = baseDeps();
    await runSubagent(deps as any, { repoPath: "/r", worktreeRoot: "/r", id: "a", prompt: "x", onStatus: (s) => statuses.push(s) });
    expect(statuses).toEqual(["running", "done"]);
    expect(deps.waitForExit).toHaveBeenCalledWith(42);
  });
  it("failed on non-zero exit", async () => {
    const statuses: string[] = [];
    const deps = baseDeps({ waitForExit: vi.fn().mockResolvedValue({ exitCode: 1 }) });
    await runSubagent(deps as any, { repoPath: "/r", worktreeRoot: "/r", id: "a", prompt: "x", onStatus: (s) => statuses.push(s) });
    expect(statuses).toEqual(["running", "failed"]);
  });
  it("failed when spawn throws (never reaches running)", async () => {
    const statuses: string[] = [];
    const deps = baseDeps({ spawnAgent: vi.fn().mockRejectedValue(new Error("no worktree")) });
    await runSubagent(deps as any, { repoPath: "/r", worktreeRoot: "/r", id: "a", prompt: "x", onStatus: (s) => statuses.push(s) });
    expect(statuses).toEqual(["failed"]);
  });
});
