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
  runGitQuery: DispatchDeps["runGitQuery"];
  spawnAgent: DispatchDeps["spawnAgent"];
  /** resolve when the agent PTY exits, with its exit code */
  waitForExit: (ptyId: number) => Promise<{ exitCode: number | null }>;
  runVerification: VerifyDeps["runVerification"];
  /** kill a hung agent PTY (used by the agent timeout); optional for tests */
  killAgent?: (ptyId: number) => Promise<void>;
}

export interface RunStoryInput {
  root: string;
  /** the filesystem path to the story's code repo (may differ from root in multi-repo) */
  repoPath: string;
  /** the logical repo id for the story's code repo (e.g. "main", "backend", "mobile") */
  repoId: string;
  epic: number;
  story: number;
  /** composed agent prompt (see composeDispatchPrompt) */
  prompt: string;
  /** verification steps: project command + any pack checks (composeVerification) */
  commands: string[];
  timeoutSecs: number;
  /** kill the agent if it hasn't exited after this many seconds (0/undefined = no cap) */
  agentTimeoutSecs?: number;
  model?: string;
  env?: Record<string, string>;
  retriesOnNonZero?: number;
  /** Claude session id for this story (enables --resume on retry) */
  sessionId?: string;
  /** true → resume the existing session instead of creating it */
  resumeSession?: boolean;
}

export interface RunStoryResult {
  status: Status; // Done or Failed
  dispatch: DispatchResult;
  agentExitCode: number | null;
  /** true when the agent was killed for exceeding agentTimeoutSecs */
  timedOut?: boolean;
}

export async function runStory(
  deps: RunStoryDeps,
  input: RunStoryInput
): Promise<RunStoryResult> {
  await deps.setStatus(input.epic, input.story, "InProgress");

  const dispatch = await dispatchStory(
    { runGit: deps.runGit, runGitQuery: deps.runGitQuery, spawnAgent: deps.spawnAgent },
    {
      root: input.root,
      repoPath: input.repoPath,
      repoId: input.repoId,
      epic: input.epic,
      story: input.story,
      prompt: input.prompt,
      model: input.model,
      env: input.env,
      sessionId: input.sessionId,
      resumeSession: input.resumeSession,
    }
  );

  // Wait for the agent, but cap it: a hung agent (bad key, network stall) would
  // otherwise sit InProgress forever. On timeout, kill the PTY and treat as Failed.
  let timedOut = false;
  const exit = await (async () => {
    const secs = input.agentTimeoutSecs ?? 0;
    if (secs <= 0) return deps.waitForExit(dispatch.ptyId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<{ exitCode: number | null }>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        void deps.killAgent?.(dispatch.ptyId);
        resolve({ exitCode: null });
      }, secs * 1000);
    });
    const result = await Promise.race([deps.waitForExit(dispatch.ptyId), timeout]);
    if (timer) clearTimeout(timer);
    return result;
  })();

  // If the agent crashed, was killed, timed out, or exited non-zero, it did not
  // finish the work — verifying now would run against stale/HEAD code and give a
  // misleading result. Go straight to Failed (InProgress → Failed is a legal edge)
  // and skip verification. Only a clean exit 0 proceeds to the QA gate.
  if (exit.exitCode !== 0) {
    await deps.setStatus(input.epic, input.story, "Failed");
    return { status: "Failed", dispatch, agentExitCode: exit.exitCode, timedOut };
  }

  // The agent finished cleanly. Commit its work in the worktree so a later
  // integration merge actually carries the changes into main (otherwise the
  // story branch equals HEAD and the merge is a no-op that discards everything).
  const IDENT = ["-c", "user.name=Cadre", "-c", "user.email=cadre@local"];
  await deps.runGit(["add", "-A"], dispatch.worktree);
  await deps.runGit([...IDENT, "commit", "-m", `cadre: story ${input.epic}.${input.story}`, "--allow-empty"], dispatch.worktree);

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
