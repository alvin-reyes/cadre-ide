/**
 * Pure Kanban column mapping (§ Task 2 spec).
 *
 * The engine is the sole authority over story status. This module provides
 * the mapping from engine-owned Status → KanbanColumn so the board can place
 * each card deterministically, with NO side effects.
 *
 * Column mapping (single source of truth):
 *   Backlog     ← Draft | Approved | Failed | Blocked
 *   In Progress ← InProgress
 *   QA          ← InReview
 *   Completed   ← Done
 *
 * Failed/Blocked render in Backlog with an alert badge so they are
 * re-dispatchable (the engine can move them back to InProgress).
 */

import type { Status } from "./status";
import type { StoryCard } from "./board";

export type KanbanColumn = "backlog" | "inProgress" | "qa" | "completed";

export const KANBAN_COLUMNS: { id: KanbanColumn; label: string }[] = [
  { id: "backlog", label: "Backlog" },
  { id: "inProgress", label: "In Progress" },
  { id: "qa", label: "QA" },
  { id: "completed", label: "Completed" },
];

/**
 * Map an engine Status to the Kanban column it belongs in.
 * This is the single source of truth; no other code should make this decision.
 */
export function statusColumn(status: Status): KanbanColumn {
  switch (status) {
    case "InProgress":
      return "inProgress";
    case "InReview":
      return "qa";
    case "Done":
      return "completed";
    // Draft | Approved | Failed | Blocked → Backlog
    default:
      return "backlog";
  }
}

/**
 * True when the story needs human attention: Failed or Blocked.
 * These cards render with an alert border/badge in the Backlog column,
 * and expose a Re-run / Execute button to re-dispatch them.
 */
export function isAttention(status: Status): boolean {
  return status === "Failed" || status === "Blocked";
}

// ── Pure helpers for the board UI ─────────────────────────────────────────────

export interface RollupCounts {
  backlog: number;
  inProgress: number;
  qa: number;
  completed: number;
}

/**
 * Roll up per-column counts from a set of cards.
 * Used for per-epic pills and the fleet-wide header strip.
 */
export function rollupCounts(cards: { status: Status }[]): RollupCounts {
  const counts: RollupCounts = { backlog: 0, inProgress: 0, qa: 0, completed: 0 };
  for (const card of cards) {
    counts[statusColumn(card.status)]++;
  }
  return counts;
}

/**
 * Select stories that have a live agent running this session.
 * A story is "running" if it is actively mid-build/review (InProgress | InReview)
 * OR a dispatch is in-flight (active[s.id] === true) — the Approved→InProgress
 * window before the engine flips the status.
 */
export function selectRunningAgents(
  stories: StoryCard[],
  active: Record<string, boolean>
): StoryCard[] {
  return stories.filter(
    (s) => active[s.id] || s.status === "InProgress" || s.status === "InReview"
  );
}

/**
 * Group story cards into per-epic buckets plus an "other" bucket for cards
 * whose epic number has no matching entry in `epics`.
 *
 * Guarantees: no card is dropped, no card is duplicated. Cards are placed in
 * exactly one bucket (named epic bucket if matched, "other" if not).
 */
export function groupIntoLanes<
  C extends { epic: number },
  E extends { number: number },
>(
  cards: C[],
  epics: E[]
): { epicBuckets: Map<number, C[]>; otherCards: C[] } {
  const epicNumbers = new Set(epics.map((e) => e.number));
  const epicBuckets = new Map<number, C[]>(epics.map((e) => [e.number, []]));
  const otherCards: C[] = [];
  for (const card of cards) {
    if (epicNumbers.has(card.epic)) {
      epicBuckets.get(card.epic)!.push(card);
    } else {
      otherCards.push(card);
    }
  }
  return { epicBuckets, otherCards };
}

/**
 * Derive the fleet ROLE of the agent building a story from its `[phase]` title
 * tag (the SM tags backlog stories with their lifecycle phase). Lets the Fleet
 * org chart label DevOps and Docs agents distinctly from Dev/QA — the role
 * reflects the STORY type, independent of its status.
 */
export type StoryRoleKind = "dev" | "qa" | "devops" | "docs";
export function storyRole(title: string): { kind: StoryRoleKind; label: string } {
  const m = title.match(/^\s*\[([^\]]+)\]/);
  const phase = (m ? m[1] : "").toLowerCase();
  if (/(ops|devops|deploy|infra|\bci\b|\bcd\b|release|monitor|observ)/.test(phase)) return { kind: "devops", label: "DevOps" };
  if (/(doc|support)/.test(phase)) return { kind: "docs", label: "Docs" };
  if (/(qa|test|e2e|accept|integration)/.test(phase)) return { kind: "qa", label: "QA" };
  return { kind: "dev", label: "Dev" };
}
