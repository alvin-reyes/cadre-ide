import { describe, it, expect } from "vitest";
import { integrateStory, type IntegrateDeps } from "./integrate";

describe("integrateStory", () => {
  it("merges the story branch with --no-ff and reports merged", async () => {
    const calls: string[][] = [];
    const deps: IntegrateDeps = {
      runGit: async (args) => {
        calls.push(args);
      },
    };
    const res = await integrateStory(deps, { root: "/proj", epic: 1, story: 2 });

    expect(res).toEqual({ merged: true, conflict: false });
    const merge = calls.find((a) => a.includes("merge"))!;
    expect(merge).toContain("--no-ff");
    expect(merge).toContain("story/1.2");
  });

  it("aborts and reports a conflict when the merge fails, leaving main clean", async () => {
    const calls: string[][] = [];
    const deps: IntegrateDeps = {
      runGit: async (args) => {
        calls.push(args);
        if (args.includes("merge") && !args.includes("--abort")) {
          throw new Error("CONFLICT (content): Merge conflict in src/a.ts");
        }
      },
    };
    const res = await integrateStory(deps, { root: "/proj", epic: 3, story: 1 });

    expect(res).toEqual({ merged: false, conflict: true });
    // It must abort the failed merge so main isn't left half-merged.
    expect(calls).toContainEqual(["merge", "--abort"]);
  });

  it("tolerates a failing abort (nothing to abort)", async () => {
    const deps: IntegrateDeps = {
      runGit: async (args) => {
        if (args.includes("merge")) throw new Error("boom");
      },
    };
    const res = await integrateStory(deps, { root: "/proj", epic: 1, story: 1 });
    expect(res).toEqual({ merged: false, conflict: true });
  });
});
