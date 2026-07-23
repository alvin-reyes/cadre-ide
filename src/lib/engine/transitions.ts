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
  Done: ["Approved", "Blocked"], // re-open for scope change; Blocked if it can't merge back

};

export function canTransition(from: Status, to: Status): boolean {
  // A same-status write is an idempotent no-op (e.g. re-dispatching an already
  // InProgress story on resume), not an illegal jump.
  return from === to || LEGAL[from].includes(to);
}

export function assertTransition(from: Status, to: Status): void {
  if (!canTransition(from, to)) {
    throw new Error(`illegal status transition: ${from} -> ${to}`);
  }
}
