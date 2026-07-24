/**
 * dispatchStory (§6.1, §6.2): spawn one Dev agent for a story as a `claude -p`
 * process that is the PTY's direct child (clean exit signal), in its own git
 * worktree on a per-story branch. The git + PTY primitives are injected so the
 * orchestration is testable; in production they wrap Tauri commands.
 */

import { repoWorktreePath } from "./repos";

/**
 * Parse `git worktree list --porcelain` output and return every worktree path
 * whose checked-out branch matches `branch` (the short name, e.g. "story/1.2").
 * Exported so it can be unit-tested in isolation.
 *
 * Porcelain format — each worktree is a blank-line-separated block:
 *   worktree /path/to/wt
 *   HEAD <sha>
 *   branch refs/heads/<name>          ← present unless detached
 *
 * Detached-HEAD entries have `detached` instead of a `branch` line; those are
 * skipped because they can't be on the target branch.
 */
export function worktreesForBranch(porcelain: string, branch: string): string[] {
  const target = `refs/heads/${branch}`;
  const paths: string[] = [];
  // Each block is separated by one or more blank lines.
  const blocks = porcelain.split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    let wt: string | null = null;
    let matched = false;
    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        wt = line.slice("worktree ".length).trim();
      } else if (line.startsWith("branch ") && line.trim() === `branch ${target}`) {
        matched = true;
      }
    }
    if (matched && wt !== null) {
      paths.push(wt);
    }
  }
  return paths;
}

export function storyBranch(epic: number, story: number): string {
  return `story/${epic}.${story}`;
}

/** Where the agent drops its (advisory) result marker; the watcher sees it. */
export function resultMarkerPath(root: string, epic: number, story: number): string {
  return `${root}/.cadre/markers/${epic}.${story}.json`;
}

export interface AlwaysFile {
  path: string;
  content: string;
}

/**
 * Compose the full prompt the Dev agent receives: the persona system prompt,
 * the project standards it must always follow, the story, and the TDD +
 * do-not-self-report directive.
 */
export function composeDispatchPrompt(input: {
  systemPrompt: string;
  storyMarkdown: string;
  alwaysFiles: AlwaysFile[];
}): string {
  const { systemPrompt, storyMarkdown, alwaysFiles } = input;
  const parts: string[] = [systemPrompt, ""];

  if (alwaysFiles.length > 0) {
    parts.push("## Project standards (always follow)");
    for (const file of alwaysFiles) {
      parts.push(`\n### ${file.path}\n${file.content}`);
    }
    parts.push("");
  }

  parts.push("## Your story");
  parts.push(storyMarkdown);
  parts.push("");
  parts.push(
    "Implement this story test-first: write the failing test, then the code to " +
      "make it pass. Do NOT mark the story done yourself — Cadre runs the " +
      "verification command and decides. When finished, write your result marker " +
      "and stop."
  );

  return parts.join("\n");
}

export interface DispatchDeps {
  /** run a git command in `cwd` (throws on failure) */
  runGit: (args: string[], cwd: string) => Promise<void>;
  /** non-throwing variant — returns exit code + stdout (e.g. for porcelain queries) */
  runGitQuery: (args: string[], cwd: string) => Promise<{ exitCode: number | null; stdout: string }>;
  /** spawn the agent as a PTY's direct child; returns the pty id */
  spawnAgent: (opts: {
    command: string;
    args: string[];
    cwd: string;
    env?: Record<string, string>;
  }) => Promise<number>;
}

export interface DispatchInput {
  root: string;
  /** the code repo the story targets (=== root when path:".") */
  repoPath: string;
  /** the repo id used to namespace the worktree path */
  repoId: string;
  epic: number;
  story: number;
  /** the composed prompt (see composeDispatchPrompt) */
  prompt: string;
  /** model to route this agent to (undefined = default Claude) */
  model?: string;
  /** per-agent env (ModelRouter: ANTHROPIC_BASE_URL/AUTH_TOKEN/MODEL) */
  env?: Record<string, string>;
  /** Claude session id for this story — enables --resume on retry to keep context */
  sessionId?: string;
  /** when true, resume the existing session (retry) instead of creating a new one */
  resumeSession?: boolean;
}

export interface DispatchResult {
  ptyId: number;
  branch: string;
  worktree: string;
}

export async function dispatchStory(
  deps: DispatchDeps,
  input: DispatchInput
): Promise<DispatchResult> {
  const branch = storyBranch(input.epic, input.story);
  const worktree = repoWorktreePath(input.root, input.repoId, input.epic, input.story);

  // Make dispatch idempotent. A prior run that was killed mid-story (e.g. the app
  // was closed) leaves this worktree + branch behind, which would make
  // `worktree add -b` fail with "already exists". Clear any stale copy first —
  // tolerant, since there's nothing to remove on a first dispatch. The
  // interrupted run's partial, unverified work is intentionally discarded; the
  // story re-runs clean from HEAD.
  // All worktree/branch management runs in the CODE REPO (repoPath), not the
  // Cadre project root — the worktree is registered in the code repo's git graph.
  const tryGit = async (args: string[]) => {
    try {
      await deps.runGit(args, input.repoPath);
    } catch {
      /* nothing to clean up */
    }
  };

  // Belt-and-suspenders: remove the expected worktree path first (fast path).
  await tryGit(["worktree", "remove", "--force", worktree]);

  // `git branch -D <branch>` refuses to delete a branch that is checked out in
  // ANY worktree — not just the expected path. If a prior interrupted run left a
  // worktree on this branch at a DIFFERENT path, branch -D would silently fail
  // (swallowed by tryGit) and then `worktree add -b` would blow up with
  // "already exists". Enumerate ALL worktrees on the branch and remove them first.
  const { stdout: porcelain } = await deps.runGitQuery(
    ["worktree", "list", "--porcelain"],
    input.repoPath
  ).catch(() => ({ stdout: "" }));
  for (const stalePath of worktreesForBranch(porcelain, branch)) {
    await tryGit(["worktree", "remove", "--force", stalePath]);
  }

  await tryGit(["worktree", "prune"]);
  await tryGit(["branch", "-D", branch]);

  // Isolate the story in its own worktree on a per-story branch.
  await deps.runGit(["worktree", "add", "-b", branch, worktree, "HEAD"], input.repoPath);

  // --dangerously-skip-permissions lets the headless agent actually use its tools
  // (edit files, run the build) without interactive permission prompts — without it
  // the agent can't modify code and the story always fails.
  //
  // All option flags go BEFORE the `-p <prompt>` positional so none can be misread as
  // the prompt value. Session handling: a fresh story mints its id (--session-id); a
  // re-dispatch resumes it (--resume) so the retry keeps the prior attempt's context.
  const args = ["--dangerously-skip-permissions"];
  if (input.sessionId) {
    args.push(input.resumeSession ? "--resume" : "--session-id", input.sessionId);
  }
  if (input.model) {
    args.push("--model", input.model);
  }
  args.push("-p", input.prompt);

  const ptyId = await deps.spawnAgent({
    command: "claude",
    args,
    cwd: worktree,
    env: input.env,
  });

  return { ptyId, branch, worktree };
}
