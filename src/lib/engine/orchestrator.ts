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
  /** the filesystem path to the story's code repo (may differ from root in multi-repo) */
  repoPath: string;
  /** the logical repo id for the story's code repo (e.g. "main", "backend", "mobile") */
  repoId: string;
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

  // Select the per-repo verify commands if available (Task 5 adds repoVerification to
  // PlanApproval); until then repoVerification is undefined and this falls back to the
  // global frozen verification — behavior is unchanged for single-repo projects.
  const commands = (approval as { repoVerification?: Record<string, string[]> }).repoVerification?.[input.repoId] ?? approval.verification;

  return runStory(deps, {
    root: input.root,
    repoPath: input.repoPath,
    repoId: input.repoId,
    epic: input.epic,
    story: input.story,
    prompt: input.prompt,
    // The command the agent is judged against is the human-frozen one — the
    // caller cannot substitute it, and an agent cannot forge it.
    commands,
    timeoutSecs: input.timeoutSecs,
    agentTimeoutSecs: input.agentTimeoutSecs,
    model: input.model,
    env: input.env,
    retriesOnNonZero: input.retriesOnNonZero,
    sessionId: input.sessionId,
    resumeSession: input.resumeSession,
  });
}
