/**
 * startSubagent — start ONE maintenance subagent: create its isolated task/<id>
 * worktree + spawn the agent (dispatchTask), set "running", then watch for exit
 * in a DETACHED promise that drives status from the PROCESS (done on exit 0,
 * failed on non-zero or a spawn error). Status is process-derived, never
 * self-reported — the fix for the old frozen "running" badge.
 *
 * The awaited part is just the spawn/worktree phase; the caller serializes that
 * across a batch (concurrent `git worktree add` on one repo races on git locks)
 * while the detached exit-watch lets the agents themselves still run concurrently.
 * Returns the ptyId, or null on a spawn failure.
 */
import { dispatchTask } from "../engine/dispatchTask";
import type { DispatchDeps } from "../engine/dispatch";
import type { SubagentStatus } from "./tasks";

export type RunSubagentDeps = DispatchDeps & {
  waitForExit: (ptyId: number) => Promise<{ exitCode: number | null }>;
};

export async function startSubagent(
  deps: RunSubagentDeps,
  input: {
    repoPath: string;
    worktreeRoot: string;
    id: string;
    prompt: string;
    env?: Record<string, string>;
    model?: string;
    onStatus: (s: SubagentStatus) => void;
  },
): Promise<number | null> {
  let ptyId: number;
  try {
    const res = await dispatchTask(deps, input);
    ptyId = res.ptyId;
  } catch {
    input.onStatus("failed");
    return null;
  }
  input.onStatus("running");
  // Detached: lets the caller serialize the spawn phase (git worktree creation)
  // while agents still run concurrently. Status stays process-derived.
  void deps.waitForExit(ptyId)
    .then(({ exitCode }) => input.onStatus(exitCode === 0 ? "done" : "failed"))
    .catch(() => input.onStatus("failed"));
  return ptyId;
}
