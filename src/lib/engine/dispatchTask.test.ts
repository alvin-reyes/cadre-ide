import { describe, it, expect, vi } from "vitest";
import { dispatchTask } from "./dispatchTask";

function deps() {
  return {
    runGit: vi.fn().mockResolvedValue(undefined),
    runGitQuery: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "" }),
    spawnAgent: vi.fn().mockResolvedValue(42),
  };
}

describe("dispatchTask", () => {
  it("creates a task/<id> worktree and spawns the agent in it", async () => {
    const d = deps();
    const res = await dispatchTask(d, {
      repoPath: "/repo", worktreeRoot: "/repo", id: "a1", prompt: "bump deps",
    });
    expect(res.branch).toBe("task/a1");
    expect(res.worktree).toBe("/repo/.cadre/worktrees/task-a1");
    // worktree created on the task branch
    expect(d.runGit).toHaveBeenCalledWith(
      ["worktree", "add", "-b", "task/a1", "/repo/.cadre/worktrees/task-a1", "HEAD"], "/repo",
    );
    // agent spawned in that worktree, prompt passed after the flags
    const spawn = d.spawnAgent.mock.calls[0][0];
    expect(spawn.cwd).toBe("/repo/.cadre/worktrees/task-a1");
    expect(spawn.command).toBe("claude");
    expect(spawn.args[spawn.args.length - 2]).toBe("-p");
    expect(spawn.args[spawn.args.length - 1]).toContain("bump deps");
    expect(res.ptyId).toBe(42);
  });

  it("passes per-agent env and model through to spawn", async () => {
    const d = deps();
    await dispatchTask(d, {
      repoPath: "/repo", worktreeRoot: "/repo", id: "a2", prompt: "x",
      env: { ANTHROPIC_BASE_URL: "u" }, model: "claude-sonnet-4-6",
    });
    const spawn = d.spawnAgent.mock.calls[0][0];
    expect(spawn.env).toEqual({ ANTHROPIC_BASE_URL: "u" });
    expect(spawn.args).toContain("--model");
    expect(spawn.args).toContain("claude-sonnet-4-6");
  });
});
