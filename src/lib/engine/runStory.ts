import { dispatchStory, type DispatchDeps, type DispatchResult } from "./dispatch";
import { verifyStory, type VerifyDeps } from "./verifyStory";
import type { Status } from "./status";

/**
 * runStory (§5 FLEET) — the lifecycle of one story through the state machine:
 *   InProgress → (agent implements) → InReview → (engine verifies) → Done | Failed
 *
 * The engine, not the agent, drives every transition. Composed from
 * dispatchStory + verifyStory; all side effects are injected for testability.
 */
export interface RunStoryDeps {
  setStatus: (epic: number, story: number, status: Status) => Promise<void>;
  runGit: DispatchDeps["runGit"];
  spawnAgent: DispatchDeps["spawnAgent"];
  /** resolve when the agent PTY exits, with its exit code */
  waitForExit: (ptyId: number) => Promise<{ exitCode: number | null }>;
  runVerification: VerifyDeps["runVerification"];
}

export interface RunStoryInput {
  root: string;
  epic: number;
  story: number;
  /** composed agent prompt (see composeDispatchPrompt) */
  prompt: string;
  /** verification steps: project command + any pack checks (composeVerification) */
  commands: string[];
  timeoutSecs: number;
  model?: string;
  env?: Record<string, string>;
  retriesOnNonZero?: number;
}

export interface RunStoryResult {
  status: Status; // Done or Failed
  dispatch: DispatchResult;
  agentExitCode: number | null;
}

export async function runStory(
  deps: RunStoryDeps,
  input: RunStoryInput
): Promise<RunStoryResult> {
  await deps.setStatus(input.epic, input.story, "InProgress");

  const dispatch = await dispatchStory(
    { runGit: deps.runGit, spawnAgent: deps.spawnAgent },
    {
      root: input.root,
      epic: input.epic,
      story: input.story,
      prompt: input.prompt,
      model: input.model,
      env: input.env,
    }
  );

  const exit = await deps.waitForExit(dispatch.ptyId);

  // If the agent crashed, was killed, or exited non-zero, it did not finish the
  // work — verifying now would run against stale/HEAD code and give a misleading
  // result. Go straight to Failed (InProgress → Failed is a legal edge) and skip
  // verification. Only a clean exit 0 proceeds to the QA gate.
  if (exit.exitCode !== 0) {
    await deps.setStatus(input.epic, input.story, "Failed");
    return { status: "Failed", dispatch, agentExitCode: exit.exitCode };
  }

  // The agent finished cleanly (whatever it claims). The engine now verifies.
  await deps.setStatus(input.epic, input.story, "InReview");

  const verify = await verifyStory(
    { runVerification: deps.runVerification, setStatus: deps.setStatus },
    {
      epic: input.epic,
      story: input.story,
      cwd: dispatch.worktree,
      commands: input.commands,
      timeoutSecs: input.timeoutSecs,
      retriesOnNonZero: input.retriesOnNonZero,
    }
  );

  return { status: verify.status, dispatch, agentExitCode: exit.exitCode };
}
