import { describe, it, expect } from "vitest";
import { composeResolverPrompt, resolveMergeConflict, resolverBranch, resolverWorktreePath } from "./resolveConflict";

function fakeDeps(script: {
  unmergedAfterAgent?: string;   // stdout of the diff --filter=U probe (empty = resolved)
  agentExit?: number | null;
  verifyExit?: number | null;
  ffThrows?: boolean;
}) {
  const git: string[][] = [];
  const deps = {
    runGit: async (args: string[]) => {
      git.push(args);
      if (script.ffThrows && args.includes("--ff-only")) throw new Error("not fast-forward");
    },
    runGitQuery: async (args: string[]) => {
      git.push(args);
      if (args.includes("--diff-filter=U")) return { exitCode: 0, stdout: script.unmergedAfterAgent ?? "" };
      return { exitCode: 0, stdout: "" }; // merge leaves conflict, non-throwing
    },
    spawnAgent: async () => 1,
    waitForExit: async () => ({ exitCode: script.agentExit ?? 0 }),
    runVerification: async () => ({ exitCode: script.verifyExit ?? 0, timedOut: false }),
  };
  return { deps, git };
}

const base = { root: "/proj", epic: 1, story: 2, storyBranch: "story/1.2", prompt: "P", commands: ["npm test"], timeoutSecs: 60 };

describe("resolveMergeConflict", () => {
  it("resolves, verifies, and fast-forwards into main → resolved:true", async () => {
    const { deps, git } = fakeDeps({ unmergedAfterAgent: "", agentExit: 0, verifyExit: 0 });
    const r = await resolveMergeConflict(deps, base);
    expect(r.resolved).toBe(true);
    // worktree created off HEAD, merged story branch, then ff-only into main
    expect(git.some((a) => a[0] === "worktree" && a[1] === "add")).toBe(true);
    expect(git.some((a) => a.includes("--ff-only") && a.includes(resolverBranch(1,2)))).toBe(true);
  });
  it("unresolved markers remain → resolved:false reason unresolved, no ff-only", async () => {
    const { deps, git } = fakeDeps({ unmergedAfterAgent: "src/a.ts\n", agentExit: 0, verifyExit: 0 });
    const r = await resolveMergeConflict(deps, base);
    expect(r).toEqual({ resolved: false, reason: "unresolved" });
    expect(git.some((a) => a.includes("--ff-only"))).toBe(false);
  });
  it("agent non-zero exit → resolved:false reason agent-failed", async () => {
    const { deps } = fakeDeps({ agentExit: 1 });
    expect(await resolveMergeConflict(deps, base)).toEqual({ resolved: false, reason: "agent-failed" });
  });
  it("verification red after resolution → resolved:false reason verify-failed, main untouched", async () => {
    const { deps, git } = fakeDeps({ unmergedAfterAgent: "", agentExit: 0, verifyExit: 1 });
    const r = await resolveMergeConflict(deps, base);
    expect(r).toEqual({ resolved: false, reason: "verify-failed" });
    expect(git.some((a) => a.includes("--ff-only"))).toBe(false);
  });
  it("fast-forward into main fails → resolved:false reason integrate-failed, cleaned up", async () => {
    const { deps } = fakeDeps({ unmergedAfterAgent: "", agentExit: 0, verifyExit: 0, ffThrows: true });
    expect(await resolveMergeConflict(deps, base)).toEqual({ resolved: false, reason: "integrate-failed" });
  });
  it("composeResolverPrompt includes the story, context files, and a resolve+commit directive", () => {
    const p = composeResolverPrompt({ storyMarkdown: "# Story 1.2", alwaysFiles: [{ path: ".cadre/context/api.md", content: "contract" }], epic: 1, story: 2 });
    expect(p).toContain("# Story 1.2");
    expect(p).toContain("contract");
    expect(p).toMatch(/conflict/i);
    expect(p).toMatch(/commit/i);
  });
  it("path helpers", () => {
    expect(resolverBranch(1,2)).toBe("resolve/1.2");
    expect(resolverWorktreePath("/proj",1,2)).toBe("/proj/.cadre/worktrees/resolve-1.2");
  });
});
