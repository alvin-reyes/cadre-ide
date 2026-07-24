import { describe, it, expect } from "vitest";
import {
  storyBranch,
  resultMarkerPath,
  composeDispatchPrompt,
  dispatchStory,
  worktreesForBranch,
  type DispatchDeps,
} from "./dispatch";

describe("path helpers", () => {
  it("computes the per-story branch and marker paths", () => {
    expect(storyBranch(1, 2)).toBe("story/1.2");
    expect(resultMarkerPath("/proj", 1, 2)).toBe(
      "/proj/.cadre/markers/1.2.json"
    );
  });
});

describe("composeDispatchPrompt", () => {
  it("includes the persona prompt, standards, story, and the discipline directive", () => {
    const prompt = composeDispatchPrompt({
      systemPrompt: "You are James, the Full Stack Developer.",
      storyMarkdown: "## Story 1.1\nAs a user I want to log in.",
      alwaysFiles: [{ path: "coding-standards.md", content: "Use TDD." }],
    });
    expect(prompt).toContain("You are James");
    expect(prompt).toContain("### coding-standards.md");
    expect(prompt).toContain("Use TDD.");
    expect(prompt).toContain("As a user I want to log in.");
    expect(prompt).toContain("test-first");
    expect(prompt).toContain("Do NOT mark the story done yourself");
  });

  it("omits the standards section when there are no always-files", () => {
    const prompt = composeDispatchPrompt({
      systemPrompt: "You are James.",
      storyMarkdown: "story body",
      alwaysFiles: [],
    });
    expect(prompt).not.toContain("Project standards");
  });
});

describe("worktreesForBranch", () => {
  const PORCELAIN_TWO_WTS = [
    "worktree /main/repo",
    "HEAD abc123",
    "branch refs/heads/main",
    "",
    "worktree /wt/story/1.2",
    "HEAD def456",
    "branch refs/heads/story/1.2",
    "",
    "worktree /other/wt/story/1.2",
    "HEAD ghi789",
    "branch refs/heads/story/1.2",
    "",
  ].join("\n");

  const PORCELAIN_DETACHED = [
    "worktree /main/repo",
    "HEAD abc123",
    "branch refs/heads/main",
    "",
    "worktree /detached",
    "HEAD bbb000",
    "detached",
    "",
  ].join("\n");

  it("returns all worktree paths whose branch matches the target", () => {
    expect(worktreesForBranch(PORCELAIN_TWO_WTS, "story/1.2")).toEqual([
      "/wt/story/1.2",
      "/other/wt/story/1.2",
    ]);
  });

  it("returns empty array when the target branch is not present", () => {
    expect(worktreesForBranch(PORCELAIN_TWO_WTS, "story/9.9")).toEqual([]);
  });

  it("skips detached-HEAD entries", () => {
    expect(worktreesForBranch(PORCELAIN_DETACHED, "main")).toEqual([
      "/main/repo",
    ]);
    expect(worktreesForBranch(PORCELAIN_DETACHED, "story/1.2")).toEqual([]);
  });

  it("returns empty array for empty porcelain output", () => {
    expect(worktreesForBranch("", "story/1.2")).toEqual([]);
  });

  it("handles a single worktree block with no trailing newline", () => {
    const single = "worktree /the/path\nHEAD abc\nbranch refs/heads/story/2.3";
    expect(worktreesForBranch(single, "story/2.3")).toEqual(["/the/path"]);
    expect(worktreesForBranch(single, "story/1.2")).toEqual([]);
  });
});

describe("dispatchStory", () => {
  function recordingDeps(porcelain = "") {
    const calls: {
      git: { args: string[]; cwd: string }[];
      gitQuery: { args: string[]; cwd: string }[];
      spawn: {
        command: string;
        args: string[];
        cwd: string;
        env?: Record<string, string>;
      }[];
    } = { git: [], gitQuery: [], spawn: [] };
    const deps: DispatchDeps = {
      runGit: async (args, cwd) => {
        calls.git.push({ args, cwd });
      },
      runGitQuery: async (args, cwd) => {
        calls.gitQuery.push({ args, cwd });
        return { exitCode: 0, stdout: porcelain };
      },
      spawnAgent: async (opts) => {
        calls.spawn.push(opts);
        return 42;
      },
    };
    return { deps, calls };
  }

  it("creates a per-story worktree then spawns claude -p in it", async () => {
    const { deps, calls } = recordingDeps();
    const result = await dispatchStory(deps, {
      root: "/proj", repoPath: "/proj", repoId: "main",
      epic: 1, story: 2, prompt: "PROMPT",
    });

    // Idempotent: clears any stale worktree/branch from a killed run, then adds fresh.
    // runGit calls: remove (belt-and-suspenders), prune, branch -D, add -b.
    // No extra removes because runGitQuery returns empty porcelain (no stale worktrees).
    expect(calls.git).toEqual([
      { args: ["worktree", "remove", "--force", "/proj/.cadre/worktrees/main/1.2"], cwd: "/proj" },
      { args: ["worktree", "prune"], cwd: "/proj" },
      { args: ["branch", "-D", "story/1.2"], cwd: "/proj" },
      { args: ["worktree", "add", "-b", "story/1.2", "/proj/.cadre/worktrees/main/1.2", "HEAD"], cwd: "/proj" },
    ]);
    // The porcelain query runs in the code repo.
    expect(calls.gitQuery).toEqual([
      { args: ["worktree", "list", "--porcelain"], cwd: "/proj" },
    ]);
    expect(calls.spawn).toHaveLength(1);
    expect(calls.spawn[0].command).toBe("claude");
    expect(calls.spawn[0].args).toEqual(["--dangerously-skip-permissions", "-p", "PROMPT"]);
    expect(calls.spawn[0].cwd).toBe("/proj/.cadre/worktrees/main/1.2");

    expect(result).toEqual({
      ptyId: 42,
      branch: "story/1.2",
      worktree: "/proj/.cadre/worktrees/main/1.2",
    });
  });

  it("routes worktree git to the story's code repo", async () => {
    const { deps, calls } = recordingDeps();
    await dispatchStory(deps, { root: "/proj", repoPath: "/code/api", repoId: "api", epic: 2, story: 1, prompt: "P" });
    expect(calls.git[0]).toEqual({ args: ["worktree", "remove", "--force", "/proj/.cadre/worktrees/api/2.1"], cwd: "/code/api" });
    expect(calls.git[calls.git.length - 1]).toEqual({ args: ["worktree", "add", "-b", "story/2.1", "/proj/.cadre/worktrees/api/2.1", "HEAD"], cwd: "/code/api" });
    expect(calls.spawn[0].cwd).toBe("/proj/.cadre/worktrees/api/2.1");
  });

  it("is idempotent: tolerates cleanup failures and still dispatches (first run / recovery)", async () => {
    // On a first dispatch there's nothing to remove, so the cleanup git calls
    // throw ("not a working tree" / "branch not found"). Dispatch must swallow
    // those and still create the worktree + spawn the agent.
    const seen: string[][] = [];
    const deps: DispatchDeps = {
      runGit: async (args) => {
        seen.push(args);
        if (args[0] === "branch" || (args[0] === "worktree" && args[1] !== "add")) {
          throw new Error("nothing to clean up");
        }
      },
      runGitQuery: async () => ({ exitCode: 0, stdout: "" }),
      spawnAgent: async () => 7,
    };
    const result = await dispatchStory(deps, { root: "/proj", repoPath: "/proj", repoId: "main", epic: 1, story: 2, prompt: "P" });

    expect(seen).toContainEqual(["worktree", "remove", "--force", "/proj/.cadre/worktrees/main/1.2"]);
    expect(seen).toContainEqual(["branch", "-D", "story/1.2"]);
    expect(seen).toContainEqual(["worktree", "add", "-b", "story/1.2", "/proj/.cadre/worktrees/main/1.2", "HEAD"]);
    expect(result.ptyId).toBe(7);
  });

  it("removes ALL worktrees on the story branch (stale worktree at a different path)", async () => {
    // Simulates the bug: a prior run left story/1.2 checked out at an unexpected path.
    // The porcelain query reports it; dispatch must remove it before branch -D.
    const stalePorcelain = [
      "worktree /proj",
      "HEAD aaa",
      "branch refs/heads/main",
      "",
      "worktree /tmp/old-1.2",
      "HEAD bbb",
      "branch refs/heads/story/1.2",
      "",
    ].join("\n");

    const removed: string[] = [];
    const { deps, calls } = recordingDeps(stalePorcelain);
    const origRunGit = deps.runGit;
    deps.runGit = async (args, cwd) => {
      if (args[0] === "worktree" && args[1] === "remove") removed.push(args[3]);
      return origRunGit(args, cwd);
    };

    await dispatchStory(deps, {
      root: "/proj", repoPath: "/proj", repoId: "main",
      epic: 1, story: 2, prompt: "P",
    });

    // The stale path at /tmp/old-1.2 must have been removed.
    expect(removed).toContain("/tmp/old-1.2");
    // The expected worktree path is also removed (belt-and-suspenders).
    expect(removed).toContain("/proj/.cadre/worktrees/main/1.2");
    // worktree add -b must still succeed (it's the last git call).
    expect(calls.git[calls.git.length - 1].args).toEqual([
      "worktree", "add", "-b", "story/1.2", "/proj/.cadre/worktrees/main/1.2", "HEAD",
    ]);
  });

  it("passes --model and env when routing to a specific model", async () => {
    const { deps, calls } = recordingDeps();
    await dispatchStory(deps, {
      root: "/proj", repoPath: "/proj", repoId: "main",
      epic: 3,
      story: 1,
      prompt: "P",
      model: "kimi-k2",
      env: { ANTHROPIC_BASE_URL: "https://api.moonshot.ai/anthropic" },
    });
    expect(calls.spawn[0].args).toEqual(["--dangerously-skip-permissions", "--model", "kimi-k2", "-p", "P"]);
    expect(calls.spawn[0].env).toEqual({
      ANTHROPIC_BASE_URL: "https://api.moonshot.ai/anthropic",
    });
  });

  it("passes --session-id for a fresh session and --resume for a retry (before the -p prompt)", async () => {
    const fresh = recordingDeps();
    await dispatchStory(fresh.deps, { root: "/proj", repoPath: "/proj", repoId: "main", epic: 1, story: 2, prompt: "P", sessionId: "sess-1" });
    expect(fresh.calls.spawn[0].args).toEqual(["--dangerously-skip-permissions", "--session-id", "sess-1", "-p", "P"]);

    const retry = recordingDeps();
    await dispatchStory(retry.deps, { root: "/proj", repoPath: "/proj", repoId: "main", epic: 1, story: 2, prompt: "P", sessionId: "sess-1", resumeSession: true });
    expect(retry.calls.spawn[0].args).toEqual(["--dangerously-skip-permissions", "--resume", "sess-1", "-p", "P"]);
  });
});
