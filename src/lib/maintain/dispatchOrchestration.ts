import { dispatchTask } from "../engine/dispatchTask";
import type { DispatchDeps } from "../engine/dispatch";
import type { TaskStatus } from "./tasks";

/**
 * Pure orchestration glue for a maintenance task: create the worktree/branch and
 * spawn the agent (dispatchTask), then report the resulting status transition.
 * Slice 1 has no verify step yet, so a successful spawn stops at "running" — the
 * verify → "verified"/"failed" transition lands in a later slice.
 */
export async function runMaintainTask(
  deps: DispatchDeps,
  input: {
    repoPath: string;
    worktreeRoot: string;
    id: string;
    prompt: string;
    env?: Record<string, string>;
    model?: string;
    onStatus: (s: TaskStatus) => void;
  },
): Promise<void> {
  try {
    await dispatchTask(deps, input);
    input.onStatus("running");
  } catch {
    input.onStatus("failed");
  }
}
