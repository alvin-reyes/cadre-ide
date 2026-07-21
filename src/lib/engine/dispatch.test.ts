import { describe, it, expect } from "vitest";
import {
  storyBranch,
  storyWorktreePath,
  resultMarkerPath,
  composeDispatchPrompt,
  dispatchStory,
  type DispatchDeps,
} from "./dispatch";

describe("path helpers", () => {
  it("computes the per-story branch, worktree, and marker paths", () => {
    expect(storyBranch(1, 2)).toBe("story/1.2");
    expect(storyWorktreePath("/proj", 1, 2)).toBe(
      "/proj/.cadre/worktrees/1.2"
    );
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

describe("dispatchStory", () => {
  function recordingDeps() {
    const calls: {
      git: { args: string[]; cwd: string }[];
      spawn: {
        command: string;
        args: string[];
        cwd: string;
        env?: Record<string, string>;
      }[];
    } = { git: [], spawn: [] };
    const deps: DispatchDeps = {
      runGit: async (args, cwd) => {
        calls.git.push({ args, cwd });
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
      root: "/proj",
      epic: 1,
      story: 2,
      prompt: "PROMPT",
    });

    expect(calls.git).toEqual([
      {
        args: ["worktree", "add", "-b", "story/1.2", "/proj/.cadre/worktrees/1.2", "HEAD"],
        cwd: "/proj",
      },
    ]);
    expect(calls.spawn).toHaveLength(1);
    expect(calls.spawn[0].command).toBe("claude");
    expect(calls.spawn[0].args).toEqual(["-p", "PROMPT"]);
    expect(calls.spawn[0].cwd).toBe("/proj/.cadre/worktrees/1.2");

    expect(result).toEqual({
      ptyId: 42,
      branch: "story/1.2",
      worktree: "/proj/.cadre/worktrees/1.2",
    });
  });

  it("passes --model and env when routing to a specific model", async () => {
    const { deps, calls } = recordingDeps();
    await dispatchStory(deps, {
      root: "/proj",
      epic: 3,
      story: 1,
      prompt: "P",
      model: "kimi-k2",
      env: { ANTHROPIC_BASE_URL: "https://api.moonshot.ai/anthropic" },
    });
    expect(calls.spawn[0].args).toEqual(["-p", "P", "--model", "kimi-k2"]);
    expect(calls.spawn[0].env).toEqual({
      ANTHROPIC_BASE_URL: "https://api.moonshot.ai/anthropic",
    });
  });
});
