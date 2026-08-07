export type TaskStatus = "queued" | "running" | "verified" | "failed";

export interface MaintainTask {
  id: string;
  prompt: string;
  status: TaskStatus;
  branch: string;
  createdAt: number;
}

export function taskBranch(id: string): string {
  return `task/${id}`;
}

export function makeTask(id: string, prompt: string, createdAt: number): MaintainTask {
  return { id, prompt, status: "queued", branch: taskBranch(id), createdAt };
}

export function setTaskStatus(tasks: MaintainTask[], id: string, status: TaskStatus): MaintainTask[] {
  return tasks.map((t) => (t.id === id ? { ...t, status } : t));
}

// Staged tasks + fleet batch model (reducers).

export type SubagentStatus = "running" | "done" | "failed";

export interface StagedTask {
  id: string;
  prompt: string;
  createdAt: number;
}

export interface SubagentRun {
  taskId: string;
  prompt: string;
  branch: string;
  status: SubagentStatus;
  log: string;
}

export interface FleetBatch {
  id: string;
  createdAt: number;
  subagents: SubagentRun[];
}

export function makeStagedTask(id: string, prompt: string, createdAt: number): StagedTask {
  return { id, prompt, createdAt };
}

export function removeStaged(list: StagedTask[], id: string): StagedTask[] {
  return list.filter((t) => t.id !== id);
}

/** Freeze a staged list into a batch of running subagents (each on task/<id>). */
export function makeBatch(id: string, staged: StagedTask[], createdAt: number): FleetBatch {
  return {
    id,
    createdAt,
    subagents: staged.map((t) => ({
      taskId: t.id,
      prompt: t.prompt,
      branch: taskBranch(t.id),
      status: "running" as const,
      log: "",
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

export function appendSubagentLog(
  batches: FleetBatch[],
  batchId: string,
  taskId: string,
  chunk: string,
): FleetBatch[] {
  return mapSubagent(batches, batchId, taskId, (s) => ({ ...s, log: s.log + chunk }));
}

export function setSubagentStatus(
  batches: FleetBatch[],
  batchId: string,
  taskId: string,
  status: SubagentStatus,
): FleetBatch[] {
  return mapSubagent(batches, batchId, taskId, (s) => ({ ...s, status }));
}
