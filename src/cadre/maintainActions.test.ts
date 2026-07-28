import { describe, it, expect, vi } from "vitest";
import { runMaintainTask } from "../lib/maintain/dispatchOrchestration";

describe("runMaintainTask", () => {
  it("marks running on a successful spawn", async () => {
    const deps = {
      runGit: vi.fn().mockResolvedValue(undefined),
      runGitQuery: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "" }),
      spawnAgent: vi.fn().mockResolvedValue(7),
    };
    const seen: string[] = [];
    await runMaintainTask(deps, { repoPath: "/r", worktreeRoot: "/r", id: "a", prompt: "p", onStatus: (s) => seen.push(s) });
    expect(seen).toEqual(["running"]);
  });
  it("marks failed when spawn throws", async () => {
    const deps = {
      runGit: vi.fn().mockResolvedValue(undefined),
      runGitQuery: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "" }),
      spawnAgent: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const seen: string[] = [];
    await runMaintainTask(deps, { repoPath: "/r", worktreeRoot: "/r", id: "a", prompt: "p", onStatus: (s) => seen.push(s) });
    expect(seen).toEqual(["failed"]);
  });
});
