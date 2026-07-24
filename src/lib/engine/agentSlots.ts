/**
 * agentSlots — pure slot-reconciliation helpers (no Tauri/React/store imports).
 *
 * ENGINE-OWNED INVARIANT: reconcileSlots is the single source of truth for
 * clamping teamSize and seeding the agent-pool slot array. useCadre's pump
 * and the UI components both delegate here so the invariant is never
 * duplicated.
 *
 * Task 1 additions:
 *  - composeRoster(maxDev, existing): AgentSlot[]  — role-composed fleet builder
 *  - agentLabel updated to handle qa / devops / dev-N ids
 */

import type { AgentSlot } from "./projectSlices";

export type { AgentSlot };

// ── Stable ids for the typed role fleet ───────────────────────────────────────

export const QA_AGENT_ID = "agent-qa" as const;
export const DEVOPS_AGENT_ID = "agent-devops" as const;

/** Return the stable agentId for a Dev slot at index i (0-based). */
export const devAgentId = (i: number): string => `agent-dev-${i}`;

// ── agentLabel ────────────────────────────────────────────────────────────────

/**
 * Convert an agentId to a human-readable label.
 *
 * Role-typed ids:
 *   "agent-qa"    → "QA"
 *   "agent-devops" → "DevOps"
 *   "agent-dev-0" → "Dev 1"  (1-based)
 *   "agent-dev-3" → "Dev 4"
 *
 * Legacy numeric ids (agent-0 … agent-N):
 *   "agent-0" → "Agent 1", "agent-3" → "Agent 4".
 *
 * An id not matching any known pattern is returned unchanged.
 */
export function agentLabel(agentId: string): string {
  if (agentId === QA_AGENT_ID) return "QA";
  if (agentId === DEVOPS_AGENT_ID) return "DevOps";

  const devM = agentId.match(/^agent-dev-(\d+)$/);
  if (devM) return `Dev ${Number(devM[1]) + 1}`;

  const legacyM = agentId.match(/^agent-(\d+)$/);
  if (legacyM) return `Agent ${Number(legacyM[1]) + 1}`;

  return agentId;
}

// ── reconcileSlots (legacy, kept for Task 2 callers) ─────────────────────────

const MIN_TEAM_SIZE = 1;
const MAX_TEAM_SIZE = 8;

/**
 * Produce exactly `teamSize` slots (agent-0 … agent-(N-1)), clamped to [1, 8].
 * Any slot whose agentId matches an existing slot is reused as-is (preserving
 * currentStory and status); new slots are fresh { agentId, currentStory: null,
 * status: "idle" }.
 *
 * Edge cases:
 * - teamSize ≤ 0, NaN, or negative → clamped to 1
 * - teamSize > 8 → clamped to 8
 * - Shrinking drops the high-index slots (existing slots beyond N are ignored).
 *
 * @deprecated Use composeRoster for the role-composed fleet (Task 2 will migrate
 * callers). Kept here so existing callers (Team.tsx, AgentOrgChart.tsx,
 * useCadre.ts) compile without change until Task 2.
 */
export function reconcileSlots(teamSize: number, existing: AgentSlot[]): AgentSlot[] {
  // Clamp: treat NaN and negatives as 1.
  const safeSize = Number.isFinite(teamSize) && teamSize >= MIN_TEAM_SIZE
    ? Math.min(teamSize, MAX_TEAM_SIZE)
    : MIN_TEAM_SIZE;

  const existingMap = new Map(existing.map((s) => [s.agentId, s]));

  return Array.from({ length: safeSize }, (_, i) => {
    const agentId = `agent-${i}`;
    return existingMap.get(agentId) ?? { agentId, currentStory: null, status: "idle" as const };
  });
}

// ── composeRoster ─────────────────────────────────────────────────────────────

const MIN_DEV_COUNT = 1;
const MAX_DEV_COUNT = 8;

/**
 * Build a role-composed fleet roster:
 *   [ qaSlot, devopsSlot, devSlot-0, …, devSlot-(N-1) ]
 *
 * Always emits exactly 1 QA slot + 1 DevOps slot, plus clamp(maxDev, 1, 8) Dev slots.
 *
 * Each slot is reused from `existing` (matched by agentId, preserving
 * currentStory and status) or produced as a fresh idle slot.
 *
 * Inputs are never mutated.
 */
export function composeRoster(maxDev: number, existing: AgentSlot[]): AgentSlot[] {
  const devCount = Number.isFinite(maxDev) && maxDev >= MIN_DEV_COUNT
    ? Math.min(maxDev, MAX_DEV_COUNT)
    : MIN_DEV_COUNT;

  const existingMap = new Map(existing.map((s) => [s.agentId, s]));

  const makeSlot = (agentId: string, role: "qa" | "devops" | "dev"): AgentSlot => {
    const existing = existingMap.get(agentId);
    if (existing) {
      // Reuse the slot, but ensure the role field is set correctly.
      return { ...existing, role };
    }
    return { agentId, role, currentStory: null, status: "idle" };
  };

  const qaSlot = makeSlot(QA_AGENT_ID, "qa");
  const devopsSlot = makeSlot(DEVOPS_AGENT_ID, "devops");
  const devSlots = Array.from({ length: devCount }, (_, i) =>
    makeSlot(devAgentId(i), "dev")
  );

  return [qaSlot, devopsSlot, ...devSlots];
}
