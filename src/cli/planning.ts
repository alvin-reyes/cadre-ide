/**
 * Planning half of the `cadre` CLI — the Node-side PM / Architect / SM turns.
 *
 * The desktop Planning Studio runs these turns through
 * `src/lib/planning/planningChat.ts`, but that module pulls the app's
 * browser-only graph (zustand `usageStore`, demo-mode mock SDK) and sets
 * `dangerouslyAllowBrowser` — importing it into the CommonJS CLI build would
 * drag that graph into a Node target. So we REIMPLEMENT the one primitive the
 * CLI needs — a single tool-forced turn (`callTool`) — directly on
 * `@anthropic-ai/sdk` (already a dependency; Node needs no browser flag). Same
 * signature and request shape as `planningChat.callTool`. The prompts/tools
 * themselves are the REAL ones, imported from `src/lib/planning/*` (pure).
 *
 * Auth: planning uses the Anthropic API (not the `claude` CLI login). The key is
 * resolved from ANTHROPIC_API_KEY, else the macOS keychain (service
 * `dev.cadre.ide`, account `anthropic_api_key` — see providers.ts + secrets.rs).
 */

import Anthropic from "@anthropic-ai/sdk";
import { execFile } from "node:child_process";

import type { PlanApproval } from "../lib/engine/planApproval";
import type { Status } from "../lib/engine/status";
import { canTransition } from "../lib/engine/transitions";

/**
 * The default planning-brain model. Mirrors `useCadre.ts` `MODEL` /
 * `planningModel()` (the project/Settings overrides live in zustand, unreachable
 * from Node); `CADRE_PLANNING_MODEL` overrides it for a headless run.
 */
export const PLANNING_MODEL = "claude-opus-4-8";

export function planningModel(): string {
  return process.env.CADRE_PLANNING_MODEL?.trim() || PLANNING_MODEL;
}

/** Reads the raw key from the macOS keychain (or null on any failure). Injectable for tests. */
export type KeychainReader = () => Promise<string | null>;

/** How long to wait for the keychain read before giving up. Generous, so a human
 *  has time to approve the macOS access dialog, but bounded so a never-approved
 *  prompt can't hang a headless run forever (the original bug: no timeout). */
export const KEYCHAIN_TIMEOUT_MS = 60_000;

const defaultKeychainReader: KeychainReader = () =>
  new Promise((resolve) => {
    execFile(
      "security",
      ["find-generic-password", "-s", "dev.cadre.ide", "-a", "anthropic_api_key", "-w"],
      // Also bound the child itself, belt-and-suspenders with the race below.
      { timeout: KEYCHAIN_TIMEOUT_MS },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        const key = String(stdout).trim();
        resolve(key.length > 0 ? key : null);
      }
    );
  });

/**
 * Resolve the Anthropic planning key: `ANTHROPIC_API_KEY` first, else the macOS
 * keychain (`security find-generic-password -s dev.cadre.ide -a
 * anthropic_api_key -w`). Returns the trimmed key, or `null` when neither has
 * one (a trailing newline on a pasted key silently breaks the API, so trim).
 *
 * The keychain read is BOUNDED: reading the value (`-w`) can trigger a macOS
 * access-approval dialog, and a headless process would otherwise block on it
 * forever. So we race the read against a timeout, and — only if it's actually
 * waiting — emit a one-time hint telling the user to approve the dialog (or set
 * ANTHROPIC_API_KEY). `opts` is for tests (small timeout + injected reader).
 */
export function getPlanningKey(opts: {
  timeoutMs?: number;
  read?: KeychainReader;
  onHint?: (msg: string) => void;
} = {}): Promise<string | null> {
  const env = process.env.ANTHROPIC_API_KEY?.trim();
  if (env) return Promise.resolve(env);

  const timeoutMs = opts.timeoutMs ?? KEYCHAIN_TIMEOUT_MS;
  const read = opts.read ?? defaultKeychainReader;
  const onHint = opts.onHint ?? ((m) => process.stderr.write(m + "\n"));

  return new Promise((resolve) => {
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(hintTimer);
      clearTimeout(hardTimer);
      resolve(v);
    };
    // Fire the hint only if the read is still pending shortly in — so the fast
    // (already-approved) path stays silent, and a pending dialog gets a nudge.
    const hintTimer = setTimeout(() => {
      if (!done) {
        onHint(
          "[cadre] waiting for macOS keychain approval — click Allow on the dialog " +
            "(or set ANTHROPIC_API_KEY to skip the keychain)."
        );
      }
    }, Math.min(2000, Math.floor(timeoutMs / 3)));
    const hardTimer = setTimeout(() => finish(null), timeoutMs);
    read().then(finish, () => finish(null));
  });
}

// ── Model-alias fallback (ported from planningChat: keep calls alive if the
//    configured id doesn't resolve on the account) ─────────────────────────────

function fallbackModel(model: string): string {
  return model.toLowerCase().includes("opus")
    ? "claude-opus-4-20250514"
    : "claude-sonnet-4-20250514";
}

function isModelError(e: unknown): boolean {
  const s = String((e as { message?: string })?.message ?? e).toLowerCase();
  return (
    s.includes("model") &&
    (s.includes("not_found") ||
      s.includes("not found") ||
      s.includes("404") ||
      s.includes("does not exist") ||
      s.includes("invalid model"))
  );
}

/**
 * Force a single tool call and return the tool's `input` — the Node twin of
 * `planningChat.callTool` (same signature + request shape), minus the
 * browser-only usage recorder and `dangerouslyAllowBrowser`.
 */
export async function callTool(opts: {
  apiKey: string;
  /** optional Anthropic-compatible base URL (Kimi / DeepSeek) */
  baseUrl?: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  tool: unknown;
}): Promise<unknown> {
  const client = new Anthropic({
    apiKey: opts.apiKey,
    ...(opts.baseUrl ? { baseURL: opts.baseUrl } : {}),
  });
  const tool = opts.tool as Anthropic.Tool;
  const runCreate = (model: string) =>
    client.messages.create({
      model,
      max_tokens: 4096,
      system: opts.systemPrompt,
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
      messages: [{ role: "user", content: opts.userPrompt }],
    });

  let response: Anthropic.Message;
  try {
    response = await runCreate(opts.model);
  } catch (e) {
    if (isModelError(e) && opts.model !== fallbackModel(opts.model)) {
      response = await runCreate(fallbackModel(opts.model));
    } else {
      throw e;
    }
  }

  for (const block of response.content) {
    if (block.type === "tool_use") return block.input;
  }
  throw new Error("model did not call the tool");
}

// ── Pure helpers (unit-tested) ────────────────────────────────────────────────

/**
 * The PLAN-approval object the CLI writes to `.cadre/approvals/plan.json` so
 * `cadre run` can proceed. Shape matches `PlanApproval` (planApproval.ts) and the
 * Rust `PlanApproval`: `{ approved: true, verification: [<cmd>] }`.
 */
export function planApproval(verification: string[]): PlanApproval {
  return { approved: true, verification };
}

/**
 * Whether a story at `current` status may be moved to Approved (Draft → Approved,
 * or an idempotent re-approve). Wraps the engine's legal-edge guard so `cadre
 * approve` never writes an illegal transition (e.g. InProgress → Approved).
 */
export function canApprove(current: Status | null): boolean {
  return canTransition(current ?? "Draft", "Approved");
}
