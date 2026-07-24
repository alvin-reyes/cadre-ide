import { describe, it, expect } from "vitest";
import { integrateStory, type IntegrateDeps } from "./integrate";

describe("integrateStory", () => {
  it("merges the story branch with --no-ff and reports merged", async () => {
    const calls: { args: string[]; cwd: string }[] = [];
    const deps: IntegrateDeps = {
      runGit: async (args, cwd) => {
        calls.push({ args, cwd });
      },
    };
    const res = await integrateStory(deps, { root: "/proj", repoPath: "/proj", epic: 1, story: 2 });

    expect(res).toEqual({ merged: true, conflict: false });
    const merge = calls.find((c) => c.args.includes("merge"))!;
    expect(merge.args).toContain("--no-ff");
    expect(merge.args).toContain("story/1.2");
    expect(merge.cwd).toBe("/proj");
  });

  it("merges in the code repo (repoPath), not the project root", async () => {
    const calls: { args: string[]; cwd: string }[] = [];
    const deps: IntegrateDeps = {
      runGit: async (args, cwd) => {
        calls.push({ args, cwd });
      },
    };
    const res = await integrateStory(deps, { root: "/proj", repoPath: "/code/api", epic: 1, story: 2 });

    expect(res).toEqual({ merged: true, conflict: false });
    const merge = calls.find((c) => c.args.includes("merge"))!;
    expect(merge.cwd).toBe("/code/api");
  });

  it("aborts and reports a conflict when the merge fails, leaving main clean", async () => {
    const calls: { args: string[]; cwd: string }[] = [];
    const deps: IntegrateDeps = {
      runGit: async (args, cwd) => {
        calls.push({ args, cwd });
        if (args.includes("merge") && !args.includes("--abort")) {
          throw new Error("CONFLICT (content): Merge conflict in src/a.ts");
        }
      },
    };
    const res = await integrateStory(deps, { root: "/proj", repoPath: "/proj", epic: 3, story: 1 });

    expect(res).toEqual({ merged: false, conflict: true });
    // It must abort the failed merge so main isn't left half-merged.
    expect(calls.map((c) => c.args)).toContainEqual(["merge", "--abort"]);
    // Abort must also run in the code repo
    const abort = calls.find((c) => c.args.includes("--abort"))!;
    expect(abort.cwd).toBe("/proj");
  });

  it("tolerates a failing abort (nothing to abort)", async () => {
    const deps: IntegrateDeps = {
      runGit: async (args) => {
        if (args.includes("merge")) throw new Error("boom");
      },
    };
    const res = await integrateStory(deps, { root: "/proj", repoPath: "/proj", epic: 1, story: 1 });
    expect(res).toEqual({ merged: false, conflict: true });
  });
});
