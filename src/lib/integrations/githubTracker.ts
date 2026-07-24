/**
 * githubTracker — pure GitHub Issues sync core.
 *
 * Maps a Cadre story + status to `gh api` calls over an injected GhRunner.
 * No Tauri, no Zustand, no React. Unit-tested in githubTracker.test.ts.
 *
 * One-way push (Cadre → GitHub) for v1.
 * Transport is the `gh` CLI via `gh api`. Never store a GitHub token here.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GhRunner = (
  args: string[]
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export interface TrackerStory {
  epic: number;
  story: number;
  title: string;
  acceptanceCriteria?: string;
}

export type TrackerStatus =
  | "Draft"
  | "Approved"
  | "InProgress"
  | "InReview"
  | "Done"
  | "Failed"
  | "Blocked";

export interface SyncStoryInput {
  /** "owner/repo" */
  repo: string;
  story: TrackerStory;
  status: TrackerStatus;
  /** The frozen verification command, surfaced in the Done comment. */
  verifyCmd?: string;
  /** Existing issue mapping, if any. Absent → create a new issue. */
  issueNumber?: number;
}

export interface SyncStoryResult {
  issueNumber: number;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** "[epic.story] title" */
export function issueTitle(s: TrackerStory): string {
  return `[${s.epic}.${s.story}] ${s.title}`;
}

/** Issue body: optional acceptance criteria section + "Tracked by Cadre" footer. */
export function issueBody(s: TrackerStory): string {
  const parts: string[] = [];
  if (s.acceptanceCriteria) {
    parts.push(`## Acceptance Criteria\n\n${s.acceptanceCriteria}`);
  }
  parts.push(`---\n_Tracked by Cadre_`);
  return parts.join("\n\n");
}

/** true only for "Done" — the only status that closes a GitHub issue. */
export function statusIsClosed(status: TrackerStatus): boolean {
  return status === "Done";
}

/**
 * Compose the transition comment posted on every status change.
 * Done (with verifyCmd) → "✅ Verified by Cadre — the frozen verification command `<cmd>` passed."
 * Done (no verifyCmd)  → "✅ Verified by Cadre — the frozen verification command passed."
 * Other statuses       → "Cadre: status → <status>"
 */
export function transitionComment(
  status: TrackerStatus,
  verifyCmd?: string
): string {
  if (status === "Done") {
    if (verifyCmd) {
      return `✅ Verified by Cadre — the frozen verification command \`${verifyCmd}\` passed.`;
    }
    return `✅ Verified by Cadre — the frozen verification command passed.`;
  }
  return `Cadre: status → ${status}`;
}

// ---------------------------------------------------------------------------
// gh api argument builders
// ---------------------------------------------------------------------------

function createIssueArgs(repo: string, story: TrackerStory): string[] {
  return [
    "api",
    `repos/${repo}/issues`,
    "-f",
    `title=${issueTitle(story)}`,
    "-f",
    `body=${issueBody(story)}`,
  ];
}

function patchStateArgs(
  repo: string,
  issueNumber: number,
  state: "open" | "closed"
): string[] {
  return [
    "api",
    `repos/${repo}/issues/${issueNumber}`,
    "-X",
    "PATCH",
    "-f",
    `state=${state}`,
  ];
}

function postCommentArgs(
  repo: string,
  issueNumber: number,
  body: string
): string[] {
  return [
    "api",
    `repos/${repo}/issues/${issueNumber}/comments`,
    "-f",
    `body=${body}`,
  ];
}

// ---------------------------------------------------------------------------
// Core: run a gh call and throw on non-zero exit
// ---------------------------------------------------------------------------

async function runOrThrow(
  gh: GhRunner,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  const result = await gh(args);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `gh ${args[0]} failed (exit ${result.exitCode})`);
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

// ---------------------------------------------------------------------------
// syncStory — orchestration
// ---------------------------------------------------------------------------

/**
 * Sync a Cadre story + status to GitHub Issues.
 *
 * - No issueNumber → create a new issue (POST), parse `.number`, return it.
 *   If status is Done, also PATCH closed + post verified comment.
 * - With issueNumber → PATCH state (open|closed) + post a transition comment.
 * - Any gh call with exitCode !== 0 throws so the store layer can reportError.
 */
export async function syncStory(
  gh: GhRunner,
  input: SyncStoryInput
): Promise<SyncStoryResult> {
  const { repo, story, status, verifyCmd, issueNumber } = input;

  if (issueNumber === undefined) {
    // ── Create path ──────────────────────────────────────────────────────
    const { stdout } = await runOrThrow(gh, createIssueArgs(repo, story));
    const parsed = JSON.parse(stdout) as { number: number };
    const newIssueNumber = parsed.number;

    // If already Done on first sync: close and post verified comment
    if (statusIsClosed(status)) {
      await runOrThrow(gh, patchStateArgs(repo, newIssueNumber, "closed"));
      await runOrThrow(
        gh,
        postCommentArgs(
          repo,
          newIssueNumber,
          transitionComment(status, verifyCmd)
        )
      );
    }

    return { issueNumber: newIssueNumber };
  }

  // ── Update path ───────────────────────────────────────────────────────
  const state: "open" | "closed" = statusIsClosed(status) ? "closed" : "open";
  await runOrThrow(gh, patchStateArgs(repo, issueNumber, state));
  await runOrThrow(
    gh,
    postCommentArgs(repo, issueNumber, transitionComment(status, verifyCmd))
  );

  return { issueNumber };
}
