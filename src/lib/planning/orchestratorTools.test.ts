import { describe, it, expect } from "vitest";
import { ORCHESTRATOR_TOOLS, runOrchestratorTool, type OrchestratorActions } from "./orchestratorTools";

function fakeActions(): OrchestratorActions & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    shardStory: async (e) => { calls.push(`shardStory ${e}`); },
    shardBacklog: async (e) => { calls.push(`shardBacklog ${e}`); },
    approveStory: async (e, s) => { calls.push(`approveStory ${e}.${s}`); },
    dispatchStory: async (e, s) => { calls.push(`dispatchStory ${e}.${s}`); },
    dispatchReady: async () => { calls.push(`dispatchReady`); },
  };
}

describe("orchestrator tools", () => {
  it("exposes the allowlist and NOT approve_plan", () => {
    const names = ORCHESTRATOR_TOOLS.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["shard_story","shard_backlog","approve_story","dispatch_story","dispatch_ready"]));
    expect(names).not.toContain("approve_plan");
  });
  it("dispatch_story runs the action with validated args", async () => {
    const a = fakeActions();
    const r = await runOrchestratorTool("dispatch_story", { epic: 1, story: 2 }, a);
    expect(r.ok).toBe(true);
    expect(a.calls).toContain("dispatchStory 1.2");
  });
  it("shard_story defaults epic to 1 when omitted", async () => {
    const a = fakeActions();
    await runOrchestratorTool("shard_story", {}, a);
    expect(a.calls).toContain("shardStory 1");
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
