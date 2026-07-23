import { runStory, type RunStoryDeps, type RunStoryResult } from "./runStory";
import type { PlanApproval } from "./planApproval";

/**
 * The orchestrator facade — the seam the UI phase calls to run one story. It
 * closes the trust loop: the verification command comes from the PLAN approval
 * (frozen, human-confirmed, engine-owned), NOT from the caller. And it enforces
 * the PLAN gate at runtime — no approval, no dispatch (§6.1).
 */
export interface OrchestratorDeps extends RunStoryDeps {
  getPlanApproval: () => Promise<PlanApproval | null>;
}

export interface RunApprovedStoryInput {
  root: string;
  epic: number;
  story: number;
  /** composed agent prompt (see composeDispatchPrompt) */
  prompt: string;
  timeoutSecs: number;
  agentTimeoutSecs?: number;
  model?: string;
  env?: Record<string, string>;
  retriesOnNonZero?: number;
  sessionId?: string;
  resumeSession?: boolean;
}

export async function runApprovedStory(
  deps: OrchestratorDeps,
  input: RunApprovedStoryInput
): Promise<RunStoryResult> {
  const approval = await deps.getPlanApproval();
  if (!approval || !approval.approved || approval.verification.length === 0) {
    throw new Error(
      "PLAN gate: the plan is not approved with a frozen verification command"
    );
  }

  return runStory(deps, {
    root: input.root,
    epic: input.epic,
    story: input.story,
    prompt: input.prompt,
    // The command the agent is judged against is the human-frozen one — the
    // caller cannot substitute it, and an agent cannot forge it.
    commands: approval.verification,
    timeoutSecs: input.timeoutSecs,
    agentTimeoutSecs: input.agentTimeoutSecs,
    model: input.model,
    env: input.env,
    retriesOnNonZero: input.retriesOnNonZero,
    sessionId: input.sessionId,
    resumeSession: input.resumeSession,
  });
}
