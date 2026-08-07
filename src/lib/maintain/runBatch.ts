/**
 * runSubagent — orchestrate ONE maintenance subagent: create its isolated
 * task/<id> worktree + spawn the agent (dispatchTask), then drive status from
 * the PROCESS via waitForExit (running while alive → done on exit 0, failed on
 * non-zero or a spawn error). This is the fix for the old frozen "running"
 * badge: status is process-derived, never self-reported.
 *
 * The batch layer calls this once per staged task, concurrently, each streaming
 * to its own SubagentRun.log via the deps' onOutput sink (wired by the caller).
 */
import { dispatchTask } from "../engine/dispatchTask";
import type { DispatchDeps } from "../engine/dispatch";
import type { SubagentStatus } from "./tasks";

export type RunSubagentDeps = DispatchDeps & {
  waitForExit: (ptyId: number) => Promise<{ exitCode: number | null }>;
};

export async function runSubagent(
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
): Promise<void> {
  let ptyId: number;
  try {
    const res = await dispatchTask(deps, input);
    ptyId = res.ptyId;
  } catch {
    input.onStatus("failed");
    return;
  }
  input.onStatus("running");
  try {
    const { exitCode } = await deps.waitForExit(ptyId);
    input.onStatus(exitCode === 0 ? "done" : "failed");
  } catch {
    input.onStatus("failed");
  }
}
