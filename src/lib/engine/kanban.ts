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
