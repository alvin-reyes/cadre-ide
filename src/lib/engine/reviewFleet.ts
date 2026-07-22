import type { DispatchDeps } from "./dispatch";
import { storyWorktreePath } from "./dispatch";

/**
 * The adversarial code-review fleet (§3.11). Each reviewer is a real **Claude
 * agent loop** (`claude -p`, the same headless Agent-SDK loop the dev agents
 * run) dispatched into the story's worktree — so it READS the actual code (git
 * diff + the files), not a diff pasted into a prompt. Every reviewer writes its
 * findings to a marker file the engine then reads. Multiple diverse lenses run
 * as a small fleet of adversary agents per story.
 *
 * Pure + dependency-injected: the spawn/wait/read side effects are injected, so
 * the orchestration is unit-tested with fakes; production wires the Tauri PTY.
 */

export interface ReviewLens {
  lens: string;
  prompt: string;
}

export interface ReviewFinding {
  severity: "blocker" | "major" | "minor";
  title: string;
  detail: string;
}

export interface LensReview {
  lens: string;
  verdict: "accept" | "block";
  findings: ReviewFinding[];
}

export interface ReviewFleetDeps {
  spawnAgent: DispatchDeps["spawnAgent"];
  waitForExit: (ptyId: number) => Promise<{ exitCode: number | null }>;
  readFile: (path: string) => Promise<string>;
}

export interface ReviewFleetInput {
  root: string;
  epic: number;
  story: number;
  lenses: ReviewLens[];
  model?: string;
  env?: Record<string, string>;
}

/** Where each lens reviewer writes its findings (engine-read, outside the agent's concern). */
export function reviewMarkerPath(root: string, epic: number, story: number, lens: string): string {
  return `${root}/.cadre/reviews/${epic}.${story}.${lens}.json`;
}

/** The prompt each reviewer agent runs — read the code, write findings to the marker. */
export function composeReviewPrompt(lens: ReviewLens, markerPath: string): string {
  return [
    lens.prompt,
    "",
    "Review the code changes in THIS worktree. Use `git diff` and read the changed files directly to judge the real code — do not rely on a summary.",
    `When finished, write your findings as JSON to \`${markerPath}\` with exactly this shape:`,
    `{ "verdict": "accept" | "block", "findings": [ { "severity": "blocker" | "major" | "minor", "title": "...", "detail": "..." } ] }`,
    "Write the file (do not print the findings to stdout), then stop. Default to \"block\" if you find any material issue.",
  ].join("\n");
}

function parseLensMarker(lens: string, raw: string): LensReview {
  const parsed = JSON.parse(raw) as { verdict?: string; findings?: unknown };
  const findings: ReviewFinding[] = Array.isArray(parsed.findings)
    ? (parsed.findings as unknown[])
        .map((f) => f as Partial<ReviewFinding>)
        .filter((f): f is ReviewFinding => !!f && typeof f.title === "string" && typeof f.detail === "string")
        .map((f) => ({
          severity: (["blocker", "major", "minor"] as const).includes(f.severity as ReviewFinding["severity"])
            ? (f.severity as ReviewFinding["severity"])
            : "major",
          title: f.title,
          detail: f.detail,
        }))
    : [];
  return { lens, verdict: parsed.verdict === "block" ? "block" : "accept", findings };
}

/** Dispatch every lens reviewer as an agent loop, then read + parse each one's findings. */
export async function reviewStory(
  deps: ReviewFleetDeps,
  input: ReviewFleetInput
): Promise<LensReview[]> {
  const worktree = storyWorktreePath(input.root, input.epic, input.story);

  return Promise.all(
    input.lenses.map(async (lens): Promise<LensReview> => {
      const marker = reviewMarkerPath(input.root, input.epic, input.story, lens.lens);
      const ptyId = await deps.spawnAgent({
        command: "claude",
        args: input.model
          ? ["-p", composeReviewPrompt(lens, marker), "--model", input.model]
          : ["-p", composeReviewPrompt(lens, marker)],
        cwd: worktree,
        env: input.env,
      });
      await deps.waitForExit(ptyId);
      try {
        const raw = await deps.readFile(marker);
        return parseLensMarker(lens.lens, raw);
      } catch {
        // No/invalid findings file ⇒ the reviewer didn't complete cleanly. Treat as a blocker,
        // never as a silent pass (verified, not vibed).
        return {
          lens: lens.lens,
          verdict: "block",
          findings: [
            {
              severity: "major",
              title: "Reviewer produced no findings file",
              detail: `The ${lens.lens} review agent did not write a valid findings marker.`,
            },
          ],
        };
      }
    })
  );
}

/** Overall verdict across the review fleet: blocked if ANY reviewer blocks. */
export function aggregateReviews(reviews: LensReview[]): {
  verdict: "accept" | "block";
  findingCount: number;
} {
  const findingCount = reviews.reduce((n, r) => n + r.findings.length, 0);
  const verdict = reviews.some((r) => r.verdict === "block") ? "block" : "accept";
  return { verdict, findingCount };
}
