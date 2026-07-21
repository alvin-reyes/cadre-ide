/**
 * PLAN approval (§6.1/§6.3). Mirrors the Rust `PlanApproval` (cadre_state.rs).
 * Written only by the engine at human approval; freezes the verification
 * command(s) the QA gate will re-read. Agents can't reach or forge it.
 */
export interface PlanApproval {
  approved: boolean;
  /** frozen verification steps (project command + any pack checks) */
  verification: string[];
}

/**
 * The PLAN gate (§5): the fleet cannot be dispatched until the PRD + architecture
 * exist AND the human has approved the plan with at least one verification step
 * frozen. No plan (and no way to prove the work), no fleet.
 */
export function canDispatch(input: {
  prdExists: boolean;
  architectureExists: boolean;
  approval: PlanApproval | null;
}): boolean {
  return (
    input.prdExists &&
    input.architectureExists &&
    input.approval !== null &&
    input.approval.approved &&
    input.approval.verification.length > 0
  );
}
