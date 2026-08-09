/**
 * Built-in templates for the Thoughts dock — reusable snippets you insert into
 * the composer, then send to the terminal (Better-Terminal style). Users add
 * their own via the dock; those live in thoughtsStore.
 */
export interface ThoughtTemplate {
  id: string;
  name: string;
  body: string;
  builtin: boolean;
}

const t = (id: string, name: string, body: string): ThoughtTemplate => ({ id, name, body, builtin: true });

export const BUILTIN_THOUGHT_TEMPLATES: ThoughtTemplate[] = [
  t("explain", "Explain this", "Explain what the code in the file I name does, and how it fits into the project."),
  t("plan", "Plan before coding", "Before writing any code, lay out a short step-by-step plan for the task and wait for my go-ahead."),
  t("test-first", "Write a failing test first", "Write a failing test that captures the desired behavior, confirm it fails, then implement the minimal change to make it pass."),
  t("fix-failing", "Fix the failing tests", "Run the test suite, find what's failing, and fix the code until everything is green. Show the failing output first."),
  t("refactor", "Refactor for clarity", "Refactor the code I name for readability without changing behavior; keep the tests green and explain each change."),
  t("review-diff", "Review the current diff", "Review the current git diff for correctness bugs, missing edge cases, and simpler equivalents. List concrete findings."),
  t("commit", "Commit the changes", "Stage the changes, write a clear conventional-commit message, and commit. Do not push."),
  t("summarize", "Summarize what changed", "Summarize everything you changed in this session: files touched, why, and anything left to verify."),
  t("harden", "Add error handling", "Add proper error handling and input validation to the code I name; surface failures instead of swallowing them."),
  t("perf", "Find a bottleneck", "Profile the slow path I describe, identify the hotspot, and propose a fix with the expected impact."),
];
