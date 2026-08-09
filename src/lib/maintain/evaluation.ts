/**
 * evaluation — the pure core for the background Guardian/Audit agents that review
 * the project's current git changes and report findings to the notification bar.
 *
 *  - Guardian: safety/risk watch (destructive ops, secrets, scope creep, unsafe patterns).
 *  - Audit:    quality/correctness (bugs, missing tests, does it accomplish the task).
 *
 * Each runs headless (`claude -p`) in the project dir, inspects the repo with its
 * own tools, and returns ONLY a JSON array of findings, which parseFindings reads.
 */
export type EvalAgent = "guardian" | "audit";
export type Severity = "critical" | "warning" | "info";

export interface Finding {
  id: string;
  root: string;
  agent: EvalAgent;
  severity: Severity;
  title: string;
  detail: string;
  at: number;
}

/** A finding as an agent emits it (before we stamp id/root/agent/at). */
export interface RawFinding { severity: Severity; title: string; detail: string; }

export const GUARDIAN_PROMPT =
  "You are the Guardian — a background SAFETY reviewer for this repository. Inspect the " +
  "CURRENT git changes: the uncommitted working tree (use `git status` and `git diff`) and " +
  "the last few commits (`git log --oneline -8`, and `git show <sha>` where useful). Flag ONLY " +
  "genuine RISKS: destructive or irreversible operations, secrets/credentials added, scope creep " +
  "beyond the apparent task, unsafe patterns (injection, disabled safeguards, history rewrite/force " +
  "push), or dependency/permission risks. Do NOT critique style or nitpick. Respond with ONLY a JSON " +
  'array (no prose, no markdown fences), each item {"severity":"critical"|"warning"|"info","title":' +
  '"<short>","detail":"<1-2 sentences, cite files>"}. If there are no real risks, respond with [].';

export const AUDIT_PROMPT =
  "You are the Auditor — a background QUALITY reviewer for this repository. Inspect the CURRENT git " +
  "changes: the uncommitted working tree (use `git status` and `git diff`) and the last few commits " +
  "(`git log --oneline -8`, `git show <sha>` where useful). Assess CORRECTNESS and QUALITY: real bugs, " +
  "broken or unhandled edge cases, missing/inadequate tests, and whether the changes actually accomplish " +
  "what they appear intended to do. Respond with ONLY a JSON array (no prose, no markdown fences), each " +
  'item {"severity":"critical"|"warning"|"info","title":"<short>","detail":"<1-2 sentences, cite files>"}. ' +
  "If the work looks sound, respond with [].";

export function promptFor(agent: EvalAgent): string {
  return agent === "guardian" ? GUARDIAN_PROMPT : AUDIT_PROMPT;
}

const SEVERITIES: Severity[] = ["critical", "warning", "info"];

/**
 * Extract the findings array from a headless agent's raw stdout. Tolerant of a
 * stray prose line or ```json fences around the array; returns [] if nothing
 * parseable is present. Never throws.
 */
export function parseFindings(raw: string): RawFinding[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let arr: unknown;
  try { arr = JSON.parse(raw.slice(start, end + 1)); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  const out: RawFinding[] = [];
  for (const x of arr) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const title = typeof o.title === "string" ? o.title.trim() : "";
    if (!title) continue;
    const severity = SEVERITIES.includes(o.severity as Severity) ? (o.severity as Severity) : "warning";
    const detail = typeof o.detail === "string" ? o.detail.trim() : "";
    out.push({ severity, title, detail });
  }
  return out;
}

/** Rank for sorting/rollup — critical first. */
export function severityRank(s: Severity): number {
  return s === "critical" ? 0 : s === "warning" ? 1 : 2;
}
