/**
 * agentSlots — pure slot-reconciliation helpers (no Tauri/React/store imports).
 *
 * ENGINE-OWNED INVARIANT: reconcileSlots is the single source of truth for
 * clamping teamSize and seeding the agent-pool slot array. useCadre's pump
 * and the UI components both delegate here so the invariant is never
 * duplicated.
 */

import type { AgentSlot } from "./projectSlices";

export type { AgentSlot };

/**
 * Convert an agentId to a human-readable label.
 * "agent-0" → "Agent 1", "agent-3" → "Agent 4".
 * An id not matching /^agent-(\d+)$/ is returned unchanged.
 */
export function agentLabel(agentId: string): string {
  const m = agentId.match(/^agent-(\d+)$/);
  if (m) return `Agent ${Number(m[1]) + 1}`;
  return agentId;
}

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
