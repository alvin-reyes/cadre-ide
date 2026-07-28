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
