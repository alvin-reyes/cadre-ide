import type { DispatchDeps } from "./dispatch";
import { taskBranch } from "../maintain/tasks";

export const MAINTAIN_SYSTEM_PROMPT =
  "You are a maintenance/support engineer working in an existing codebase. Make the " +
  "smallest correct change that resolves the request, matching the surrounding code. " +
  "Do NOT open pull requests, push, close/merge PRs, or delete branches — leave your " +
  "work committed on this branch and stop.";

export interface DispatchTaskInput {
  repoPath: string;
  worktreeRoot: string;
  id: string;
  prompt: string;
  env?: Record<string, string>;
  model?: string;
}

export interface DispatchTaskResult {
  ptyId: number;
  branch: string;
  worktree: string;
}

export async function dispatchTask(deps: DispatchDeps, input: DispatchTaskInput): Promise<DispatchTaskResult> {
  const branch = taskBranch(input.id);
  const worktree = `${input.worktreeRoot}/.cadre/worktrees/task-${input.id}`;

  // Idempotent: clear any stale worktree/branch from an interrupted prior run.
  const tryGit = async (args: string[]) => {
    try { await deps.runGit(args, input.repoPath); } catch { /* nothing to clean */ }
  };
  await tryGit(["worktree", "remove", "--force", worktree]);
  await tryGit(["worktree", "prune"]);
  await tryGit(["branch", "-D", branch]);

  await deps.runGit(["worktree", "add", "-b", branch, worktree, "HEAD"], input.repoPath);

  const fullPrompt = `${MAINTAIN_SYSTEM_PROMPT}\n\n## Task\n${input.prompt}\n`;
  const args = ["--dangerously-skip-permissions"];
  if (input.model) args.push("--model", input.model);
  args.push("-p", fullPrompt);

  const ptyId = await deps.spawnAgent({ command: "claude", args, cwd: worktree, env: input.env });
  return { ptyId, branch, worktree };
}
