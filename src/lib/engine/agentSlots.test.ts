import { describe, it, expect } from "vitest";
import { agentLabel, reconcileSlots } from "./agentSlots";
import type { AgentSlot } from "./agentSlots";

// ── agentLabel ────────────────────────────────────────────────────────────────

describe("agentLabel", () => {
  it('converts "agent-0" to "Agent 1"', () => {
    expect(agentLabel("agent-0")).toBe("Agent 1");
  });

  it('converts "agent-11" to "Agent 12"', () => {
    expect(agentLabel("agent-11")).toBe("Agent 12");
  });

  it("returns non-matching ids unchanged", () => {
    expect(agentLabel("foo")).toBe("foo");
  });

  it("returns partial matches unchanged", () => {
    expect(agentLabel("agent-")).toBe("agent-");
    expect(agentLabel("agent-abc")).toBe("agent-abc");
  });
});

// ── reconcileSlots ────────────────────────────────────────────────────────────

describe("reconcileSlots", () => {
  const fresh = (i: number): AgentSlot => ({ agentId: `agent-${i}`, currentStory: null, status: "idle" });

  it("grows from 0 existing slots to N", () => {
    const result = reconcileSlots(3, []);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(fresh(0));
    expect(result[1]).toEqual(fresh(1));
    expect(result[2]).toEqual(fresh(2));
  });

  it("shrinks from N to smaller by dropping high-index slots", () => {
    const existing: AgentSlot[] = [fresh(0), fresh(1), fresh(2), fresh(3)];
    const result = reconcileSlots(2, existing);
    expect(result).toHaveLength(2);
    expect(result[0].agentId).toBe("agent-0");
    expect(result[1].agentId).toBe("agent-1");
  });

  it("reuses an existing working slot's currentStory and status", () => {
    const existing: AgentSlot[] = [
      { agentId: "agent-0", currentStory: "story-42", status: "working" },
      fresh(1),
    ];
    const result = reconcileSlots(2, existing);
    expect(result[0]).toEqual({ agentId: "agent-0", currentStory: "story-42", status: "working" });
    expect(result[1]).toEqual(fresh(1));
  });

  it("reuses a verifying slot's state", () => {
    const existing: AgentSlot[] = [
      { agentId: "agent-0", currentStory: "story-7", status: "verifying" },
    ];
    const result = reconcileSlots(1, existing);
    expect(result[0]).toEqual({ agentId: "agent-0", currentStory: "story-7", status: "verifying" });
  });

  it("clamps teamSize 0 → 1", () => {
    const result = reconcileSlots(0, []);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(fresh(0));
  });

  it("clamps teamSize 99 → 8", () => {
    const result = reconcileSlots(99, []);
    expect(result).toHaveLength(8);
    expect(result[7].agentId).toBe("agent-7");
  });

  it("clamps NaN → 1", () => {
    const result = reconcileSlots(NaN, []);
    expect(result).toHaveLength(1);
  });

  it("clamps negative → 1", () => {
    const result = reconcileSlots(-3, []);
    expect(result).toHaveLength(1);
  });

  it("exact boundary: teamSize 1 returns 1 slot", () => {
    const result = reconcileSlots(1, []);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(fresh(0));
  });

  it("exact boundary: teamSize 8 returns 8 slots", () => {
    const result = reconcileSlots(8, []);
    expect(result).toHaveLength(8);
    expect(result[7].agentId).toBe("agent-7");
  });

  it("returns fresh slots for new indices when growing", () => {
    const existing: AgentSlot[] = [
      { agentId: "agent-0", currentStory: "story-1", status: "working" },
    ];
    const result = reconcileSlots(3, existing);
    expect(result[0]).toEqual({ agentId: "agent-0", currentStory: "story-1", status: "working" });
    expect(result[1]).toEqual(fresh(1));
    expect(result[2]).toEqual(fresh(2));
  });
});
