import { describe, it, expect } from "vitest";
import { agentLabel, reconcileSlots, composeRoster, QA_AGENT_ID, DEVOPS_AGENT_ID, devAgentId } from "./agentSlots";
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

  // Role-typed ids
  it('converts "agent-qa" to "QA"', () => {
    expect(agentLabel("agent-qa")).toBe("QA");
  });

  it('converts "agent-devops" to "DevOps"', () => {
    expect(agentLabel("agent-devops")).toBe("DevOps");
  });

  it('converts "agent-dev-0" to "Dev 1" (1-based)', () => {
    expect(agentLabel("agent-dev-0")).toBe("Dev 1");
  });

  it('converts "agent-dev-3" to "Dev 4"', () => {
    expect(agentLabel("agent-dev-3")).toBe("Dev 4");
  });

  it("returns unknown id unchanged", () => {
    expect(agentLabel("totally-unknown")).toBe("totally-unknown");
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

// ── composeRoster ─────────────────────────────────────────────────────────────

describe("composeRoster", () => {
  /** Fresh idle slot for a given role-typed agentId. */
  const freshRole = (agentId: string, role: "qa" | "devops" | "dev"): AgentSlot => ({
    agentId,
    role,
    currentStory: null,
    status: "idle",
  });

  // ── Composition: always 1 QA + 1 DevOps + N Dev ───────────────────────────

  it("always emits QA as the first slot with role 'qa'", () => {
    const roster = composeRoster(2, []);
    expect(roster[0].agentId).toBe(QA_AGENT_ID);
    expect(roster[0].role).toBe("qa");
  });

  it("always emits DevOps as the second slot with role 'devops'", () => {
    const roster = composeRoster(2, []);
    expect(roster[1].agentId).toBe(DEVOPS_AGENT_ID);
    expect(roster[1].role).toBe("devops");
  });

  it("emits exactly N Dev slots for maxDev = N", () => {
    const roster = composeRoster(3, []);
    const devSlots = roster.filter((s) => s.role === "dev");
    expect(devSlots).toHaveLength(3);
    expect(devSlots[0].agentId).toBe(devAgentId(0));
    expect(devSlots[1].agentId).toBe(devAgentId(1));
    expect(devSlots[2].agentId).toBe(devAgentId(2));
  });

  it("total length is 2 + clamp(maxDev, 1, 8)", () => {
    expect(composeRoster(4, [])).toHaveLength(6); // 2 + 4
    expect(composeRoster(1, [])).toHaveLength(3); // 2 + 1
    expect(composeRoster(8, [])).toHaveLength(10); // 2 + 8
  });

  it("all Dev slots have role 'dev'", () => {
    const roster = composeRoster(4, []);
    const devSlots = roster.slice(2);
    expect(devSlots.every((s) => s.role === "dev")).toBe(true);
  });

  it("Dev slot ids are agent-dev-0 through agent-dev-(N-1)", () => {
    const roster = composeRoster(4, []);
    const devSlots = roster.slice(2);
    devSlots.forEach((slot, i) => {
      expect(slot.agentId).toBe(`agent-dev-${i}`);
    });
  });

  // ── Clamp bounds ──────────────────────────────────────────────────────────

  it("clamps maxDev 0 → 1 Dev slot", () => {
    const roster = composeRoster(0, []);
    const devSlots = roster.filter((s) => s.role === "dev");
    expect(devSlots).toHaveLength(1);
  });

  it("clamps maxDev 99 → 8 Dev slots", () => {
    const roster = composeRoster(99, []);
    const devSlots = roster.filter((s) => s.role === "dev");
    expect(devSlots).toHaveLength(8);
  });

  it("clamps NaN → 1 Dev slot", () => {
    const roster = composeRoster(NaN, []);
    const devSlots = roster.filter((s) => s.role === "dev");
    expect(devSlots).toHaveLength(1);
  });

  it("clamps negative → 1 Dev slot", () => {
    const roster = composeRoster(-5, []);
    const devSlots = roster.filter((s) => s.role === "dev");
    expect(devSlots).toHaveLength(1);
  });

  // ── Reuse preserves working slot state ───────────────────────────────────

  it("reuses QA slot's currentStory and status when it is working", () => {
    const existing: AgentSlot[] = [
      { agentId: QA_AGENT_ID, role: "qa", currentStory: "story-qa-1", status: "working" },
    ];
    const roster = composeRoster(2, existing);
    expect(roster[0]).toMatchObject({
      agentId: QA_AGENT_ID,
      role: "qa",
      currentStory: "story-qa-1",
      status: "working",
    });
  });

  it("reuses DevOps slot's state when it is verifying", () => {
    const existing: AgentSlot[] = [
      { agentId: DEVOPS_AGENT_ID, role: "devops", currentStory: "story-ops-7", status: "verifying" },
    ];
    const roster = composeRoster(2, existing);
    expect(roster[1]).toMatchObject({
      agentId: DEVOPS_AGENT_ID,
      role: "devops",
      currentStory: "story-ops-7",
      status: "verifying",
    });
  });

  it("reuses a Dev slot's state when it is working", () => {
    const existing: AgentSlot[] = [
      { agentId: devAgentId(0), role: "dev", currentStory: "story-dev-5", status: "working" },
    ];
    const roster = composeRoster(2, existing);
    const dev0 = roster.find((s) => s.agentId === devAgentId(0));
    expect(dev0).toMatchObject({
      agentId: devAgentId(0),
      role: "dev",
      currentStory: "story-dev-5",
      status: "working",
    });
  });

  it("produces a fresh idle slot when no matching existing slot is found", () => {
    const roster = composeRoster(1, []);
    expect(roster[0]).toEqual(freshRole(QA_AGENT_ID, "qa"));
    expect(roster[1]).toEqual(freshRole(DEVOPS_AGENT_ID, "devops"));
    expect(roster[2]).toEqual(freshRole(devAgentId(0), "dev"));
  });

  it("does not mutate the existing array", () => {
    const existing: AgentSlot[] = [
      { agentId: QA_AGENT_ID, role: "qa", currentStory: "story-x", status: "working" },
    ];
    const copy = existing.map((s) => ({ ...s }));
    composeRoster(2, existing);
    expect(existing).toEqual(copy);
  });

  it("reuses all three slot types simultaneously", () => {
    const existing: AgentSlot[] = [
      { agentId: QA_AGENT_ID, role: "qa", currentStory: "qa-story", status: "working" },
      { agentId: DEVOPS_AGENT_ID, role: "devops", currentStory: "ops-story", status: "verifying" },
      { agentId: devAgentId(0), role: "dev", currentStory: "dev-story", status: "working" },
    ];
    const roster = composeRoster(1, existing);
    expect(roster[0]).toMatchObject({ agentId: QA_AGENT_ID, currentStory: "qa-story", status: "working" });
    expect(roster[1]).toMatchObject({ agentId: DEVOPS_AGENT_ID, currentStory: "ops-story", status: "verifying" });
    expect(roster[2]).toMatchObject({ agentId: devAgentId(0), currentStory: "dev-story", status: "working" });
  });

  // ── Role is always overwritten to the canonical value ────────────────────

  it("always sets role='qa' on the QA slot even if the reused slot had a different role", () => {
    const existing: AgentSlot[] = [
      // Weird edge case: slot was mislabelled
      { agentId: QA_AGENT_ID, role: "dev" as "dev", currentStory: null, status: "idle" },
    ];
    const roster = composeRoster(1, existing);
    expect(roster[0].role).toBe("qa");
  });
});
