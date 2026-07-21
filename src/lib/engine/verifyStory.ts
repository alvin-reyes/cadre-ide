import type { Status } from "./status";

/**
 * verifyStory (§6.1) — THE thesis, in code.
 *
 * When a Dev agent finishes, Cadre does NOT trust its claim. The engine runs
 * the human-approved verification command itself, captures the real exit code,
 * and only then writes the authoritative `Status`. Green ⇒ `Done`; otherwise
 * `Failed` (bounded by a retry ceiling for flaky suites). An agent can never
 * set `Done`.
 */

export interface VerificationRun {
  /** process exit code; `null` if killed by a signal */
  exitCode: number | null;
  timedOut: boolean;
}

export interface VerifyDeps {
  /** run the verification command (wraps the Rust `run_verification`) */
  runVerification: (
    cwd: string,
    command: string,
    timeoutSecs: number
  ) => Promise<VerificationRun>;
  /** write the authoritative status (wraps `story_set_status`) */
  setStatus: (epic: number, story: number, status: Status) => Promise<void>;
}

export interface VerifyInput {
  epic: number;
  story: number;
  /** the worktree the story was implemented in */
  cwd: string;
  /**
   * The verification steps to run, in order — the project's own command plus any
   * vertical-pack checks (see `composeVerification`, e.g. web3's Slither). The
   * story is `Done` only if ALL steps pass; the first failure short-circuits.
   */
  commands: string[];
  timeoutSecs: number;
  /** re-run on non-zero this many times before declaring Failed (flaky suites) */
  retriesOnNonZero?: number;
  /** pause between retries (ms) — a flaky suite is likelier to change after a wait */
  retryDelayMs?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface VerifyResult {
  status: Status;
  passed: boolean;
  attempts: number;
}

export async function verifyStory(
  deps: VerifyDeps,
  input: VerifyInput
): Promise<VerifyResult> {
  const maxAttempts = (input.retriesOnNonZero ?? 0) + 1;
  let attempts = 0;
  let passed = false;

  while (attempts < maxAttempts) {
    attempts++;
    // Every step must pass; the first failure short-circuits this attempt.
    passed = true;
    for (const command of input.commands) {
      const run = await deps.runVerification(input.cwd, command, input.timeoutSecs);
      if (run.timedOut || run.exitCode !== 0) {
        passed = false;
        break;
      }
    }
    if (passed) break;
    // Back off before re-running a flaky suite (skip after the last attempt).
    if (attempts < maxAttempts && input.retryDelayMs) {
      await sleep(input.retryDelayMs);
    }
  }

  const status: Status = passed ? "Done" : "Failed";
  await deps.setStatus(input.epic, input.story, status);
  return { status, passed, attempts };
}
