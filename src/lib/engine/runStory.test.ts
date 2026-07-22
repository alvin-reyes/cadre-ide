import { describe, it, expect } from "vitest";
import { runStory, type RunStoryDeps } from "./runStory";
import type { Status } from "./status";

function makeDeps(opts: {
  agentExit: number | null;
  verifyExit: number | null;
  verifyTimedOut?: boolean;
}) {
  const statuses: Status[] = [];
  const events: string[] = [];
  const deps: RunStoryDeps = {
    setStatus: async (_e, _s, status) => {
      statuses.push(status);
    },
    runGit: async () => {
      events.push("git");
    },
    spawnAgent: async () => {
      events.push("spawn");
      return 7;
    },
    waitForExit: async (ptyId) => {
      events.push(`wait:${ptyId}`);
      return { exitCode: opts.agentExit };
    },
    runVerification: async () => {
      events.push("verify");
      return { exitCode: opts.verifyExit, timedOut: opts.verifyTimedOut ?? false };
    },
  };
  return { deps, statuses, events };
}

const input = {
  root: "/proj",
  epic: 1,
  story: 1,
  prompt: "P",
  commands: ["pnpm test"],
  timeoutSecs: 60,
};

describe("runStory", () => {
  it("walks InProgress -> InReview -> Done when verification is green", async () => {
    const { deps, statuses, events } = makeDeps({ agentExit: 0, verifyExit: 0 });
    const r = await runStory(deps, input);

    expect(statuses).toEqual(["InProgress", "InReview", "Done"]);
    expect(r.status).toBe("Done");
    expect(r.agentExitCode).toBe(0);
    // order: idempotent worktree cleanup (remove/prune/branch -D) + add, spawn
    // agent, wait for exit, then verify
    expect(events).toEqual(["git", "git", "git", "git", "spawn", "wait:7", "verify"]);
  });

  it("ends Failed when the engine's verification fails, even if the agent exited 0", async () => {
    // agent claims success (exit 0) but the real tests fail (exit 1)
    const { deps, statuses } = makeDeps({ agentExit: 0, verifyExit: 1 });
    const r = await runStory(deps, input);
    expect(statuses).toEqual(["InProgress", "InReview", "Failed"]);
    expect(r.status).toBe("Failed");
  });

  it("verifies before deciding — verification runs after the agent exits", async () => {
    const { deps, events } = makeDeps({ agentExit: 0, verifyExit: 0 });
    await runStory(deps, input);
    expect(events.indexOf("verify")).toBeGreaterThan(events.indexOf("wait:7"));
  });

  it("fails without verifying when the agent exits non-zero (crash)", async () => {
    const { deps, statuses, events } = makeDeps({ agentExit: 1, verifyExit: 0 });
    const r = await runStory(deps, input);
    expect(r.status).toBe("Failed");
    expect(r.agentExitCode).toBe(1);
    expect(statuses).toEqual(["InProgress", "Failed"]); // no InReview
    expect(events).not.toContain("verify"); // stale code is never verified
  });

  it("fails without verifying when the agent was killed (null exit)", async () => {
    const { deps, statuses, events } = makeDeps({ agentExit: null, verifyExit: 0 });
    const r = await runStory(deps, input);
    expect(r.status).toBe("Failed");
    expect(statuses).toEqual(["InProgress", "Failed"]);
    expect(events).not.toContain("verify");
  });
});
