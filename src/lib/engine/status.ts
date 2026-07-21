/**
 * Story status — mirrors the Rust `cadre_state::Status` serialization exactly
 * (§5). The engine is the sole authority for these values.
 */
export type Status =
  | "Draft"
  | "Approved"
  | "InProgress"
  | "InReview"
  | "Done"
  | "Failed"
  | "Blocked";
