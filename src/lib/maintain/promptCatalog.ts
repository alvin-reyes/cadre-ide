import type { Prompt } from "./prompts";

const b = (id: string, title: string, body: string, category: Prompt["category"]): Prompt =>
  ({ id, title, body, category, builtin: true });

export const BUILTIN_PROMPTS: Prompt[] = [
  // ── Testing ──
  b("test-add-failing", "Add a failing test first", "Write a failing test that captures the desired behavior, then implement the minimal change to make it pass.", "Testing"),
  b("test-edge-cases", "Cover edge cases", "Add edge-case and boundary tests for the module I name, then fix any bugs they reveal.", "Testing"),
  b("test-flaky", "Stabilize a flaky test", "Find why the test I name is flaky (timing, order, shared state) and make it deterministic.", "Testing"),
  b("test-regression", "Regression test for a bug", "Write a regression test reproducing the described bug, confirm it fails, then fix the code.", "Testing"),
  b("test-coverage-gap", "Fill a coverage gap", "Identify untested branches in the file I name and add focused tests for them.", "Testing"),
  // ── Refactor ──
  b("refactor-extract", "Extract a function", "Extract the selected logic into a well-named function with a clear signature; keep behavior identical and tests green.", "Refactor"),
  b("refactor-rename", "Rename for clarity", "Rename the symbol I name across the codebase to something clearer; update all references.", "Refactor"),
  b("refactor-dedupe", "Remove duplication", "Find and collapse duplicated logic in the area I name into a single reused unit.", "Refactor"),
  b("refactor-split-file", "Split an oversized file", "Split the file I name by responsibility into focused modules; keep imports and behavior intact.", "Refactor"),
  b("refactor-simplify", "Simplify control flow", "Simplify the tangled control flow in the function I name without changing behavior; keep tests green.", "Refactor"),
  // ── Debug ──
  b("debug-repro", "Reproduce and isolate", "Reproduce the described failure with the smallest input, then isolate the root cause before changing code.", "Debug"),
  b("debug-stacktrace", "Explain a stack trace", "Walk the stack trace I paste, pinpoint the failing line, and propose the fix.", "Debug"),
  b("debug-bisect", "Bisect a regression", "Use git history to find the commit that introduced the described regression and explain why.", "Debug"),
  b("debug-logging", "Add targeted logging", "Add minimal, targeted logging to diagnose the described issue; remove it once the cause is found.", "Debug"),
  b("debug-race", "Hunt a race condition", "Investigate the described intermittent bug for a race/ordering issue and make access deterministic.", "Debug"),
  // ── Review ──
  b("review-correctness", "Review for correctness", "Review the current diff for correctness bugs — off-by-one, null/undefined, error paths — and list concrete failure scenarios.", "Review"),
  b("review-security", "Review for security", "Review the current diff for injection, authz, and secret-handling issues.", "Review"),
  b("review-simplify", "Review for simplification", "Review the current diff for reuse, dead code, and simpler equivalents.", "Review"),
  b("review-perf", "Review for performance", "Review the current diff for obvious performance regressions (N+1, needless allocation, sync I/O).", "Review"),
  b("review-tests", "Review test quality", "Review the tests in the current diff for missing cases and brittle assertions.", "Review"),
  // ── Git ──
  b("git-commit-msg", "Write a commit message", "Write a conventional-commit message for the currently staged changes.", "Git"),
  b("git-split-commits", "Split into logical commits", "Split the current working changes into focused, logical commits with good messages.", "Git"),
  b("git-pr-summary", "Summarize a branch for a PR", "Summarize this branch's changes into a PR title and body with rationale and test notes.", "Git"),
  b("git-resolve-conflict", "Resolve a merge conflict", "Resolve the current merge conflict in the file I name, preserving both intents; explain the resolution.", "Git"),
  b("git-changelog", "Draft a changelog entry", "Draft a changelog entry for the changes on this branch.", "Git"),
  // ── Docs ──
  b("docs-api", "Document a public API", "Document the public API of the module I name with usage examples.", "Docs"),
  b("docs-readme", "Update the README", "Update the README to reflect the change I describe; keep it concise and accurate.", "Docs"),
  b("docs-comments", "Add why-comments", "Add doc comments explaining WHY (not what) for the non-obvious code in the file I name.", "Docs"),
  b("docs-adr", "Write an ADR", "Write a short architecture decision record for the decision I describe (context, decision, consequences).", "Docs"),
  b("docs-onboarding", "Write onboarding notes", "Write onboarding notes for a new engineer covering how to run and test the area I name.", "Docs"),
  // ── Dependencies ──
  b("deps-bump-one", "Bump one dependency", "Bump the dependency I name to the latest compatible version and fix any breakage.", "Dependencies"),
  b("deps-audit", "Audit for vulnerabilities", "Audit dependencies for known vulnerabilities and propose safe upgrades.", "Dependencies"),
  b("deps-remove-unused", "Remove unused deps", "Find and remove unused dependencies; confirm the build and tests still pass.", "Dependencies"),
  b("deps-pin", "Pin loose versions", "Pin loosely-ranged dependency versions in the area I name for reproducible builds.", "Dependencies"),
  b("deps-migrate", "Migrate off a dep", "Migrate off the dependency I name to the suggested alternative; keep behavior identical.", "Dependencies"),
  // ── Performance ──
  b("perf-profile", "Profile a slow path", "Profile the slow path I describe, find the hotspot, and propose a fix with expected impact.", "Performance"),
  b("perf-nplus1", "Fix an N+1", "Find and fix the N+1 (query or loop) in the area I name.", "Performance"),
  b("perf-memoize", "Memoize expensive work", "Memoize or cache the expensive recomputation I name, guarding correctness.", "Performance"),
  b("perf-bundle", "Trim bundle size", "Identify and trim the largest avoidable contributors to bundle size.", "Performance"),
  b("perf-async", "Parallelize independent work", "Parallelize the independent sequential awaits in the function I name.", "Performance"),
  // ── Security ──
  b("sec-injection", "Check for injection", "Audit the input-handling in the area I name for injection (SQL/shell/path) and fix it.", "Security"),
  b("sec-authz", "Check authorization", "Audit the endpoint/handler I name for missing or broken authorization checks.", "Security"),
  b("sec-secrets", "Find leaked secrets", "Scan the area I name for hard-coded secrets or secrets logged/echoed, and remediate.", "Security"),
  b("sec-deps", "Triage a CVE", "Triage the CVE I paste against this codebase and propose the minimal safe remediation.", "Security"),
  b("sec-validation", "Harden input validation", "Harden input validation and error handling on the boundary I name.", "Security"),
];
