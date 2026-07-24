/**
 * resolveConflict — agent-driven merge-conflict auto-resolver.
 *
 * When a verified story's merge-back into main conflicts, this module tries an
 * agent-driven resolution before the caller marks the story Blocked. It works
 * entirely on a throwaway `resolve/{e}.{s}` branch+worktree so main is NEVER
 * touched until a resolution is proven clean AND re-verified. Only a fully
 * green result is fast-forwarded into main (step 7). Every failure path
 * runs cleanup() and returns resolved:false without touching main.
 */

import type { AlwaysFile } from "./dispatch";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function resolverBranch(epic: number, story: number): string {
  return `resolve/${epic}.${story}`;
}

export function resolverWorktreePath(root: string, epic: number, story: number): string {
  return `${root}/.cadre/worktrees/resolve-${epic}.${story}`;
}

// ---------------------------------------------------------------------------
// Prompt composer
// ---------------------------------------------------------------------------

/**
 * Compose the prompt handed to the resolver agent: persona + Context Store
 * contracts + the story + a resolve-and-commit directive. Pure/testable.
 */
export function composeResolverPrompt(input: {
  storyMarkdown: string;
  alwaysFiles: AlwaysFile[];
  epic: number;
  story: number;
}): string {
  const { storyMarkdown, alwaysFiles, epic, story } = input;
  const parts: string[] = [];

  // System-style preamble
  parts.push(
    `You are resolving a git merge conflict for story ${epic}.${story}. ` +
      `Resolve every conflict preserving BOTH sides' intent; honor the shared ` +
      `contracts below; do NOT delete working code to make it merge. ` +
      `When done, ensure there are no conflict markers, then \`git add -A\` and commit.`
  );
  parts.push("");

  // Context Store (shared contracts / always-files)
  if (alwaysFiles.length > 0) {
    parts.push("## Shared contracts (always follow)");
    for (const file of alwaysFiles) {
      parts.push(`\n### ${file.path}\n${file.content}`);
    }
    parts.push("");
  }

  // The story itself
  parts.push("## Story");
  parts.push(storyMarkdown);
  parts.push("");

  // Resolve-and-commit directive
  parts.push(
    "Resolve all conflict markers, preserving the intent of both sides. " +
      "Do NOT skip or delete code just to eliminate a conflict — integrate it. " +
      "Once all conflicts are resolved and the code is correct, run `git add -A` " +
      "and commit your resolution. Do NOT mark the story done yourself; the engine " +
      "will re-verify and decide."
  );

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Deps + Input + Result interfaces
// ---------------------------------------------------------------------------

export interface ResolveDeps {
  runGit: (args: string[], cwd: string) => Promise<void>;
  /** like runGit but returns stdout + exit code without throwing */
  runGitQuery: (args: string[], cwd: string) => Promise<{ exitCode: number | null; stdout: string }>;
  spawnAgent: (opts: { command: string; args: string[]; cwd: string; env?: Record<string, string> }) => Promise<number>;
  waitForExit: (ptyId: number) => Promise<{ exitCode: number | null }>;
  killAgent?: (ptyId: number) => Promise<void>;
  runVerification: (cwd: string, command: string, timeoutSecs: number) => Promise<{ exitCode: number | null; timedOut: boolean }>;
}

export interface ResolveInput {
  root: string;
  epic: number;
  story: number;
  storyBranch: string;       // the story's branch to merge in
  prompt: string;            // composeResolverPrompt output
  commands: string[];        // the frozen verification steps
  timeoutSecs: number;       // verification timeout
  agentTimeoutSecs?: number; // resolver-agent kill timeout
  model?: string;
  env?: Record<string, string>;
}

export interface ResolveResult {
  resolved: boolean;  // true only if merged clean AND verification passed AND fast-forwarded into main
  reason?: string;    // "unresolved" | "agent-failed" | "verify-failed" | "integrate-failed"
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

// Fixed git identity so commits never fail on unconfigured repos.
const IDENT = ["-c", "user.name=Cadre", "-c", "user.email=cadre@local"];

export async function resolveMergeConflict(
  deps: ResolveDeps,
  input: ResolveInput
): Promise<ResolveResult> {
  const { root, epic, story } = input;
  const rBranch = resolverBranch(epic, story);
  const rw = resolverWorktreePath(root, epic, story);

  // Tolerant cleanup helper — used both at the start (idempotent) and on every
  // failure path, and at the very end after a successful integration.
  const tryGit = async (args: string[]) => {
    try {
      await deps.runGit(args, root);
    } catch {
      /* tolerant */
    }
  };

  const cleanup = async () => {
    await tryGit(["worktree", "remove", "--force", rw]);
    await tryGit(["worktree", "prune"]);
    await tryGit(["branch", "-D", rBranch]);
  };

  // ── Step 1: idempotent cleanup of any stale resolver artefacts ─────────
  await cleanup();

  // ── Step 2: create worktree + branch off HEAD ───────────────────────────
  await deps.runGit(["worktree", "add", "-b", rBranch, rw, "HEAD"], root);

  // ── Step 3: attempt merge (expect conflicts — non-throwing) ────────────
  // runGitQuery never throws; a non-zero exit from a conflicting merge is
  // expected and intentional. We do NOT abort; the agent will fix the markers.
  await deps.runGitQuery(["merge", "--no-ff", input.storyBranch], rw);

  // ── Step 4: spawn the resolver agent + agent-timeout race ──────────────
  const agentArgs = ["--dangerously-skip-permissions"];
  if (input.model) {
    agentArgs.push("--model", input.model);
  }
  agentArgs.push("-p", input.prompt);

  const ptyId = await deps.spawnAgent({
    command: "claude",
    args: agentArgs,
    cwd: rw,
    env: input.env,
  });

  // Mirror runStory's agent-timeout race + kill.
  let timedOut = false;
  const exit = await (async () => {
    const secs = input.agentTimeoutSecs ?? 0;
    if (secs <= 0) return deps.waitForExit(ptyId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<{ exitCode: number | null }>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        void deps.killAgent?.(ptyId);
        resolve({ exitCode: null });
      }, secs * 1000);
    });
    const result = await Promise.race([deps.waitForExit(ptyId), timeout]);
    if (timer) clearTimeout(timer);
    return result;
  })();

  if (exit.exitCode !== 0 || timedOut) {
    await cleanup();
    return { resolved: false, reason: "agent-failed" };
  }

  // ── Step 5: check resolution + commit if needed ─────────────────────────
  // Probe for any remaining unmerged paths.
  const probe = await deps.runGitQuery(["diff", "--name-only", "--diff-filter=U"], rw);
  if (probe.stdout.trim() !== "") {
    // Conflict markers still present — agent didn't finish resolving.
    await cleanup();
    return { resolved: false, reason: "unresolved" };
  }

  // If the agent didn't commit (working tree dirty / MERGE_HEAD still present),
  // commit the resolution for it.
  await deps.runGitQuery(["diff", "--cached", "--name-only"], rw);
  try {
    await deps.runGit(["add", "-A"], rw);
    await deps.runGit(
      [...IDENT, "commit", "-m", `cadre: resolve merge for ${epic}.${story}`, "--allow-empty"],
      rw
    );
  } catch {
    // If commit fails (e.g. nothing to commit and --allow-empty somehow errors),
    // we continue — the resolution may already be committed by the agent.
  }

  // ── Step 6: re-verify with frozen commands ──────────────────────────────
  // The agent NEVER decides Done — the engine does.
  for (const cmd of input.commands) {
    const v = await deps.runVerification(rw, cmd, input.timeoutSecs);
    if (v.exitCode !== 0 || v.timedOut) {
      await cleanup();
      return { resolved: false, reason: "verify-failed" };
    }
  }

  // ── Step 7: fast-forward main ───────────────────────────────────────────
  // This is the ONLY place main is touched — and only after clean resolution
  // AND green verification. The caller holds the merge lock so main hasn't moved.
  try {
    await deps.runGit(["merge", "--ff-only", rBranch], root);
  } catch {
    await cleanup();
    return { resolved: false, reason: "integrate-failed" };
  }

  // ── Step 8: cleanup + return success ───────────────────────────────────
  await cleanup();
  return { resolved: true };
}
