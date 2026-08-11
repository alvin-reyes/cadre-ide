/**
 * Maintenance subagents are now INTERACTIVE: each runs a live `claude` session in
 * its own isolated task/<id> worktree, so the user can watch AND steer it. This
 * module owns the two pure pieces the store/UI need:
 *
 *  - createTaskWorktree — make the isolated worktree/branch (no agent spawn). The
 *    caller serializes this across a batch, because concurrent `git worktree add`
 *    on one repo races on git's locks.
 *  - subagentCommand — the shell command each card's terminal launches to seed an
 *    interactive claude with the maintenance persona + the task prompt.
 *
 * Auth is inherited from the app's environment (same path as the main Maintain
 * terminal), so subagents use your claude.ai login when no key is set — which
 * also keeps org connectors available.
 */
import { MAINTAIN_SYSTEM_PROMPT } from "../engine/dispatchTask";
import { taskBranch } from "./tasks";

export interface CreateWorktreeDeps {
  runGit: (args: string[], cwd: string) => Promise<void>;
}

/**
 * Create the isolated worktree for a task and return its path. Idempotent: clears
 * any stale worktree/branch from an interrupted prior run before adding.
 */
export async function createTaskWorktree(
  deps: CreateWorktreeDeps,
  input: { repoPath: string; worktreeRoot: string; id: string },
): Promise<string> {
  const branch = taskBranch(input.id);
  const worktree = `${input.worktreeRoot}/.cadre/worktrees/task-${input.id}`;

  const tryGit = async (args: string[]) => {
    try { await deps.runGit(args, input.repoPath); } catch { /* nothing to clean */ }
  };
  await tryGit(["worktree", "remove", "--force", worktree]);
  await tryGit(["worktree", "prune"]);
  await tryGit(["branch", "-D", branch]);

  await deps.runGit(["worktree", "add", "-b", branch, worktree, "HEAD"], input.repoPath);
  return worktree;
}

/** POSIX single-quote a string so it survives being written into a shell verbatim. */
function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * The shell command a subagent card's terminal runs: an INTERACTIVE claude
 * (no `-p`), seeded with the maintenance persona + the task as its first message,
 * with permission prompts skipped so it can act. The user can type to steer it.
 */
export function subagentCommand(
  prompt: string,
  projectDir: string,
  opts?: { mcpConfigPath?: string },
): string {
  // Tell the agent where the project lives and that its current directory is an
  // isolated worktree of it — otherwise `.cadre/worktrees/task-<id>` looks like a
  // stray cache dir rather than the project it's meant to maintain.
  const seeded =
    `${MAINTAIN_SYSTEM_PROMPT}\n\n` +
    `## Context\n` +
    `Project directory: ${projectDir}\n` +
    `Your current working directory is an isolated git worktree of this project — it ` +
    `contains the full codebase on a dedicated branch. Make and commit your changes here.\n\n` +
    `## Task\n${prompt}\n`;
  // `; exit` closes the login shell once the claude session ends, so the card's
  // PTY-exit event fires and it flips to "exited". Until then the terminal is live
  // and the user can type to steer the agent. The login shell resolves `claude` on
  // PATH and inherits the app's auth (claude.ai login → org connectors).
  const mcpFlag = opts?.mcpConfigPath ? `--mcp-config ${shq(opts.mcpConfigPath)} ` : "";
  return `claude --dangerously-skip-permissions ${mcpFlag}${shq(seeded)}; exit`;
}
