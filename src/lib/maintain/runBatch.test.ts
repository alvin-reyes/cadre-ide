import { describe, it, expect, vi } from "vitest";
import { createTaskWorktree, subagentCommand } from "./runBatch";

describe("createTaskWorktree", () => {
  it("adds a task/<id> worktree at the deterministic path and returns it", async () => {
    const runGit = vi.fn().mockResolvedValue(undefined);
    const wt = await createTaskWorktree({ runGit }, { repoPath: "/repo", worktreeRoot: "/root", id: "a1" });
    expect(wt).toBe("/root/.cadre/worktrees/task-a1");
    // The final call is the `worktree add`, run in the repo.
    expect(runGit).toHaveBeenLastCalledWith(
      ["worktree", "add", "-b", "task/a1", "/root/.cadre/worktrees/task-a1", "HEAD"],
      "/repo",
    );
  });
  it("swallows cleanup failures but propagates an `add` failure", async () => {
    // Cleanup (remove/prune/branch -D) rejects; the final add rejects too.
    const runGit = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(
      createTaskWorktree({ runGit }, { repoPath: "/repo", worktreeRoot: "/root", id: "a1" }),
    ).rejects.toThrow("boom");
  });
  it("does not throw when only cleanup fails and the add succeeds", async () => {
    const runGit = vi.fn()
      .mockRejectedValueOnce(new Error("no worktree")) // remove
      .mockRejectedValueOnce(new Error("nothing"))     // prune
      .mockRejectedValueOnce(new Error("no branch"))   // branch -D
      .mockResolvedValueOnce(undefined);               // add
    await expect(
      createTaskWorktree({ runGit }, { repoPath: "/repo", worktreeRoot: "/root", id: "a1" }),
    ).resolves.toBe("/root/.cadre/worktrees/task-a1");
  });
});

describe("subagentCommand", () => {
  it("launches an INTERACTIVE claude (no -p) seeded with the task + project dir, quoted", () => {
    const cmd = subagentCommand("bump deps", "/proj");
    expect(cmd.startsWith("claude --dangerously-skip-permissions '")).toBe(true);
    expect(cmd).not.toContain(" -p ");
    expect(cmd).toContain("Project directory: /proj");
    expect(cmd).toContain("## Task\nbump deps");
    expect(cmd.endsWith("; exit")).toBe(true);
  });
  it("escapes single quotes in the prompt so the shell arg stays intact", () => {
    const cmd = subagentCommand("don't break", "/proj");
    expect(cmd).toContain(`don'\\''t break`);
  });
});
