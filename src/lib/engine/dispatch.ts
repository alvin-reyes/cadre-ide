/**
 * dispatchStory (§6.1, §6.2): spawn one Dev agent for a story as a `claude -p`
 * process that is the PTY's direct child (clean exit signal), in its own git
 * worktree on a per-story branch. The git + PTY primitives are injected so the
 * orchestration is testable; in production they wrap Tauri commands.
 */

export function storyBranch(epic: number, story: number): string {
  return `story/${epic}.${story}`;
}

export function storyWorktreePath(root: string, epic: number, story: number): string {
  return `${root}/.cadre/worktrees/${epic}.${story}`;
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
  epic: number;
  story: number;
  /** the composed prompt (see composeDispatchPrompt) */
  prompt: string;
  /** model to route this agent to (undefined = default Claude) */
  model?: string;
  /** per-agent env (ModelRouter: ANTHROPIC_BASE_URL/AUTH_TOKEN/MODEL) */
  env?: Record<string, string>;
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
  const worktree = storyWorktreePath(input.root, input.epic, input.story);

  // Isolate the story in its own worktree on a per-story branch.
  await deps.runGit(["worktree", "add", "-b", branch, worktree, "HEAD"], input.root);

  const args = ["-p", input.prompt];
  if (input.model) {
    args.push("--model", input.model);
  }

  const ptyId = await deps.spawnAgent({
    command: "claude",
    args,
    cwd: worktree,
    env: input.env,
  });

  return { ptyId, branch, worktree };
}
