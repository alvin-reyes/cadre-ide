import type { Status } from "./status";

/**
 * Legal Status transitions (§5). The engine is the sole writer of Status, but
 * this guard makes the *edges* explicit and un-skippable — you can't jump
 * Draft → Done, and the only path out of Done is a human-gated re-open.
 */
const LEGAL: Record<Status, Status[]> = {
  Draft: ["Approved", "Blocked"],
  Approved: ["InProgress", "Blocked"],
  InProgress: ["InReview", "Failed", "Blocked"],
  InReview: ["Done", "Failed", "Blocked"],
  Failed: ["InProgress", "Blocked"], // bounce back to retry, or block
  Blocked: ["Approved", "InProgress"], // resume after the block clears
  Done: ["Approved"], // re-open for a scope change ([v1], human-gated)
};

export function canTransition(from: Status, to: Status): boolean {
  return LEGAL[from].includes(to);
}

export function assertTransition(from: Status, to: Status): void {
  if (!canTransition(from, to)) {
    throw new Error(`illegal status transition: ${from} -> ${to}`);
  }
}
