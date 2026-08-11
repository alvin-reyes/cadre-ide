export function taskBranch(id: string): string {
  return `task/${id}`;
}

// Staged tasks + fleet batch model (reducers).

// A subagent is an interactive `claude` session in its own worktree:
//  preparing → creating the git worktree
//  running   → worktree ready, the claude terminal is live (user can steer it)
//  exited    → the claude process ended
//  failed    → the worktree could not be created (never started)
export type SubagentStatus = "preparing" | "running" | "exited" | "failed";

export interface StagedTask {
  id: string;
  prompt: string;
  createdAt: number;
}

export interface SubagentRun {
  taskId: string;
  prompt: string;
  branch: string;
  /** Absolute path of the isolated worktree this subagent's claude session runs in. */
  worktree: string;
  status: SubagentStatus;
}

export interface FleetBatch {
  id: string;
  createdAt: number;
  subagents: SubagentRun[];
  /**
   * The fleet's MCP config, resolved ONCE at batch-launch time (resolveFleetEnv is
   * async; each card's TerminalPanel spawns its PTY synchronously on mount, so
   * there's no later point to await it). Undefined when there were no enabled
   * connections or materializing the config failed — work agents then behave
   * exactly as before this wiring existed (no --mcp-config, no injected env).
   */
  mcpConfigPath?: string;
  /** Secrets for `mcpConfigPath`'s ${VAR} placeholders, injected into the work
   *  agent's child process env — never written to the fleet file or command line. */
  env?: Record<string, string>;
}

export function makeStagedTask(id: string, prompt: string, createdAt: number): StagedTask {
  return { id, prompt, createdAt };
}

export function removeStaged(list: StagedTask[], id: string): StagedTask[] {
  return list.filter((t) => t.id !== id);
}

/** Where a task's isolated worktree lives (deterministic, so cards can mount before creation finishes). */
export function taskWorktreePath(root: string, id: string): string {
  return `${root}/.cadre/worktrees/task-${id}`;
}

/** Freeze a staged list into a batch of subagents (each starts "preparing" its task/<id> worktree). */
export function makeBatch(id: string, staged: StagedTask[], createdAt: number, root: string): FleetBatch {
  return {
    id,
    createdAt,
    subagents: staged.map((t) => ({
      taskId: t.id,
      prompt: t.prompt,
      branch: taskBranch(t.id),
      worktree: taskWorktreePath(root, t.id),
      status: "preparing" as const,
    })),
  };
}

function mapSubagent(
  batches: FleetBatch[],
  batchId: string,
  taskId: string,
  fn: (s: SubagentRun) => SubagentRun,
): FleetBatch[] {
  return batches.map((b) =>
    b.id !== batchId ? b : { ...b, subagents: b.subagents.map((s) => (s.taskId === taskId ? fn(s) : s)) }
  );
}

export function setSubagentStatus(
  batches: FleetBatch[],
  batchId: string,
  taskId: string,
  status: SubagentStatus,
): FleetBatch[] {
  return mapSubagent(batches, batchId, taskId, (s) => ({ ...s, status }));
}

/** Drop one subagent from its batch (used when the user closes a card). */
export function removeSubagent(batches: FleetBatch[], batchId: string, taskId: string): FleetBatch[] {
  return batches.map((b) =>
    b.id !== batchId ? b : { ...b, subagents: b.subagents.filter((s) => s.taskId !== taskId) }
  );
}

/** Drop a whole batch (used when the user closes a Fleet tab). */
export function removeBatch(batches: FleetBatch[], batchId: string): FleetBatch[] {
  return batches.filter((b) => b.id !== batchId);
}

/** Move a subagent so it sits at another subagent's position (drag-to-reorder the grid). */
export function moveSubagent(
  batches: FleetBatch[],
  batchId: string,
  fromTaskId: string,
  toTaskId: string,
): FleetBatch[] {
  return batches.map((b) => {
    if (b.id !== batchId) return b;
    const from = b.subagents.findIndex((s) => s.taskId === fromTaskId);
    const to = b.subagents.findIndex((s) => s.taskId === toTaskId);
    if (from < 0 || to < 0 || from === to) return b;
    const next = b.subagents.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return { ...b, subagents: next };
  });
}
