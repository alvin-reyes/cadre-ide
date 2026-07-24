import { describe, it, expect } from "vitest";
import { ORCHESTRATOR_TOOLS, runOrchestratorTool, type OrchestratorActions } from "./orchestratorTools";

function fakeActions(): OrchestratorActions & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    shardStory: async (e, repoId) => {
      calls.push(`shardStory ${e}${repoId !== undefined ? ` repo=${repoId}` : ""}`);
      return "Sharded the next story.";
    },
    shardBacklog: async (e, repoId) => {
      calls.push(`shardBacklog ${e}${repoId !== undefined ? ` repo=${repoId}` : ""}`);
      return "Sharded the lifecycle backlog.";
    },
    approveStory: async (e, s) => {
      calls.push(`approveStory ${e}.${s}`);
      return `Approved story ${e}.${s}.`;
    },
    dispatchStory: async (e, s) => {
      calls.push(`dispatchStory ${e}.${s}`);
      return `Story ${e}.${s}: Done`;
    },
    dispatchReady: async () => {
      calls.push(`dispatchReady`);
      return "Dispatched 2 stories: 1 Done, 1 Failed, 0 Blocked.";
    },
  };
}

describe("orchestrator tools", () => {
  it("exposes the allowlist and NOT approve_plan", () => {
    const names = ORCHESTRATOR_TOOLS.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["shard_story","shard_backlog","approve_story","dispatch_story","dispatch_ready"]));
    expect(names).not.toContain("approve_plan");
  });

  it("dispatch_story runs the action with validated args and surfaces returned message", async () => {
    const a = fakeActions();
    const r = await runOrchestratorTool("dispatch_story", { epic: 1, story: 2 }, a);
    expect(r.ok).toBe(true);
    expect(a.calls).toContain("dispatchStory 1.2");
    expect(r.message).toBe("Story 1.2: Done");
  });

  it("dispatch_story surfaces Failed status from action return", async () => {
    const a = fakeActions();
    a.dispatchStory = async (e, s) => {
      a.calls.push(`dispatchStory ${e}.${s}`);
      return `Story ${e}.${s}: Failed`;
    };
    const r = await runOrchestratorTool("dispatch_story", { epic: 1, story: 3 }, a);
    expect(r.ok).toBe(true);
    expect(r.message).toBe("Story 1.3: Failed");
  });

  it("dispatch_ready surfaces honest counts from action return", async () => {
    const a = fakeActions();
    const r = await runOrchestratorTool("dispatch_ready", {}, a);
    expect(r.ok).toBe(true);
    expect(a.calls).toContain("dispatchReady");
    expect(r.message).toBe("Dispatched 2 stories: 1 Done, 1 Failed, 0 Blocked.");
  });

  it("shard_story defaults epic to 1 when omitted", async () => {
    const a = fakeActions();
    const r = await runOrchestratorTool("shard_story", {}, a);
    expect(r.ok).toBe(true);
    expect(a.calls).toContain("shardStory 1");
  });

  it("shard_story passes repoId when repo arg is provided", async () => {
    const a = fakeActions();
    const r = await runOrchestratorTool("shard_story", { epic: 1, repo: "api" }, a);
    expect(r.ok).toBe(true);
    expect(a.calls).toContain("shardStory 1 repo=api");
  });

  it("shard_story passes no repoId when repo arg is omitted", async () => {
    const a = fakeActions();
    await runOrchestratorTool("shard_story", { epic: 2 }, a);
    expect(a.calls).toContain("shardStory 2");
    // Finding 4 fix: toContain + asymmetric matcher passes vacuously; use .some() instead
    expect(a.calls.some((c) => c.includes("repo="))).toBe(false);
  });

  it("shard_story surfaces returned message", async () => {
    const a = fakeActions();
    const r = await runOrchestratorTool("shard_story", {}, a);
    expect(r.message).toBe("Sharded the next story.");
  });

  it("shard_backlog does not advertise a repo param in its schema (honesty gap fix)", () => {
    const tool = ORCHESTRATOR_TOOLS.find((t) => t.name === "shard_backlog");
    expect(tool).toBeDefined();
    const props = (tool!.input_schema as { properties?: Record<string, unknown> }).properties ?? {};
    expect(Object.keys(props)).not.toContain("repo");
  });

  it("shard_backlog runs successfully with just an epic", async () => {
    const a = fakeActions();
    const r = await runOrchestratorTool("shard_backlog", { epic: 1 }, a);
    expect(r.ok).toBe(true);
    // Finding 4 fix: use .some() instead of toContain + asymmetric matcher
    expect(a.calls.some((c) => c.includes("repo="))).toBe(false);
    expect(r.message).toBe("Sharded the lifecycle backlog.");
  });

  it("approve_story surfaces returned message", async () => {
    const a = fakeActions();
    const r = await runOrchestratorTool("approve_story", { epic: 2, story: 3 }, a);
    expect(r.ok).toBe(true);
    expect(r.message).toBe("Approved story 2.3.");
  });

  it("dispatch_ready needs no args", async () => {
    const a = fakeActions();
    const r = await runOrchestratorTool("dispatch_ready", {}, a);
    expect(r.ok).toBe(true);
    expect(a.calls).toContain("dispatchReady");
  });

  it("unknown tool → ok:false, does not throw", async () => {
    const a = fakeActions();
    const r = await runOrchestratorTool("rm_rf", {}, a);
    expect(r.ok).toBe(false);
    expect(a.calls).toHaveLength(0);
  });

  it("bad args (missing story) → ok:false, does not throw or call the action", async () => {
    const a = fakeActions();
    const r = await runOrchestratorTool("dispatch_story", { epic: 1 }, a);
    expect(r.ok).toBe(false);
    expect(a.calls).toHaveLength(0);
  });

  it("an action that throws is caught → ok:false", async () => {
    const a = fakeActions();
    a.dispatchStory = async () => { throw new Error("boom"); };
    const r = await runOrchestratorTool("dispatch_story", { epic: 1, story: 2 }, a);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/boom/);
  });
});
