import { runStory, type RunStoryDeps, type RunStoryResult } from "./runStory";
import type { PlanApproval } from "./planApproval";
import { DEFAULT_REPO_ID } from "./repos";

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

  // Select the per-repo verify commands with fail-closed logic:
  // - If the repo has its own frozen verify map entry, use it.
  // - If the repo is the default/main repo and has no entry, fall back to the global
  //   frozen verify (backward-compat for single-repo projects).
  // - If the repo is a NON-default repo absent from the frozen map, it was added after
  //   approval — do NOT silently use the main repo's command; refuse to dispatch.
  const rv = (approval as { repoVerification?: Record<string, string[]> }).repoVerification;
  let commands: string[];
  if (rv && rv[input.repoId] && rv[input.repoId].length > 0) {
    commands = rv[input.repoId];                 // the repo's own frozen verify
  } else if (input.repoId === DEFAULT_REPO_ID) {
    commands = approval.verification;            // single-repo / main: the global frozen verify (backward-compat)
  } else {
    throw new Error(
      `No frozen verify command for repo "${input.repoId}". Re-approve the plan so its verify command is frozen before dispatching its stories.`
    );
  }

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
