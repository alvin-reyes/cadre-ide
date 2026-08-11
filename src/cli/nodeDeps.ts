/**
 * Node implementations of the engine's injected dependencies — the headless twin
 * of `src/lib/engine/tauriDeps.ts`. The desktop app wires the engine to Tauri's
 * Rust commands (PTYs, `run_git`, `run_verification`, the state store); this
 * module wires the SAME interfaces to plain Node (`child_process`, `fs`) so the
 * `cadre` CLI runs the identical execute lifecycle with no GUI.
 *
 * Auth: dispatched agents inherit the parent process env (the user's `claude`
 * login powers dispatch + review) — we never inject an API key here.
 */

import { spawn, execFile } from "node:child_process";
import { readFile as fsReadFile, writeFile as fsWriteFile, rename, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { RunStoryDeps } from "../lib/engine/runStory";
import type { OrchestratorDeps } from "../lib/engine/orchestrator";
import type { ReviewFleetDeps } from "../lib/engine/reviewFleet";
import type { PlanApproval } from "../lib/engine/planApproval";
import type { Status } from "../lib/engine/status";
import { ExitRegistry } from "../lib/engine/exitRegistry";

/** Sink for streamed agent/verification output (mirrors tauriDeps.OutputSink). */
export type OutputSink = (chunk: string) => void;

// Per-child exit tracking, shared across every spawnAgent factory in this module
// so `waitForExit(id)` resolves regardless of which sink spawned the child. Uses
// the same registry the desktop uses (fixes the fast-exit race — the code is
// retained until a waiter consumes it).
const exits = new ExitRegistry();

// Live children by id, so a hung agent can be killed (agentTimeout / killAgent).
const children = new Map<number, ReturnType<typeof spawn>>();

let nextId = 1;

function makeSpawnAgent(onOutput?: OutputSink) {
  return async function spawnAgent(opts: {
    command: string;
    args: string[];
    cwd: string;
    env?: Record<string, string>;
  }): Promise<number> {
    const id = nextId++;
    exits.register(id);

    // Inherit the parent env (PATH/HOME/claude credentials) and layer any
    // per-agent overrides on top. stdin is ignored so a headless `claude -p`
    // never blocks waiting on a TTY.
    const child = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.set(id, child);

    child.stdout?.on("data", (buf: Buffer) => onOutput?.(buf.toString()));
    child.stderr?.on("data", (buf: Buffer) => onOutput?.(buf.toString()));

    // A spawn failure (e.g. `claude` not on PATH) surfaces as an `error` event and
    // no `exit`. Resolve the waiter with a null code so the lifecycle treats it as
    // a failed agent instead of hanging forever.
    child.on("error", (err) => {
      onOutput?.(`\n[spawn error] ${String(err)}\n`);
      children.delete(id);
      exits.resolve(id, null);
    });
    child.on("exit", (code) => {
      children.delete(id);
      exits.resolve(id, code);
    });

    return id;
  };
}

export function waitForExit(id: number): Promise<{ exitCode: number | null }> {
  return exits.wait(id);
}

function killAgent(id: number): Promise<void> {
  const child = children.get(id);
  if (child && child.pid !== undefined) {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
  return Promise.resolve();
}

/** Run `git args` in `cwd`, throwing on a non-zero exit (mirrors tauriDeps.runGit). */
export function runGit(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err) {
        const code = (err as NodeJS.ErrnoException & { code?: number }).code;
        reject(new Error(`git ${args.join(" ")} failed (exit ${code}): ${String(stderr).trim()}`));
      } else {
        resolve();
      }
    });
  });
}

/** Non-throwing variant — returns exit code + stdout without throwing on non-zero. */
export function runGitQuery(
  args: string[],
  cwd: string
): Promise<{ exitCode: number | null; stdout: string }> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        const code = (err as NodeJS.ErrnoException & { code?: number | string }).code;
        resolve({ exitCode: typeof code === "number" ? code : 1, stdout: String(stdout) });
      } else {
        resolve({ exitCode: 0, stdout: String(stdout) });
      }
    });
  });
}

function makeRunVerification(onOutput?: OutputSink) {
  return function runVerification(
    cwd: string,
    command: string,
    timeoutSecs: number
  ): Promise<{ exitCode: number | null; timedOut: boolean }> {
    if (onOutput) onOutput(`\n$ ${command}\n`);
    return new Promise((resolve) => {
      // Own process group (detached) so a wall-clock timeout can kill the WHOLE
      // tree — test runners fork workers that otherwise keep stdout open and hang
      // us for the full runtime (matches the Rust run_command behaviour).
      const child = spawn("sh", ["-c", command], {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (timeoutSecs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          try {
            if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        }, timeoutSecs * 1000);
      }
      child.stdout?.on("data", (buf: Buffer) => onOutput?.(buf.toString()));
      child.stderr?.on("data", (buf: Buffer) => onOutput?.(buf.toString()));
      child.on("error", (err) => {
        if (timer) clearTimeout(timer);
        onOutput?.(`\n[verification spawn error] ${String(err)}\n`);
        resolve({ exitCode: null, timedOut });
      });
      child.on("exit", (code) => {
        if (timer) clearTimeout(timer);
        if (onOutput) {
          onOutput(timedOut ? "\n[verification timed out]\n" : `\n[verification exit ${code}]\n`);
        }
        resolve({ exitCode: code, timedOut });
      });
    });
  };
}

/** Read a UTF-8 file (mirrors tauriDeps' `read_file`, used by the review fleet). */
export function readFile(path: string): Promise<string> {
  return fsReadFile(path, "utf8");
}

// ── Engine state store (the Node twin of the Rust CadreState) ─────────────────

function statusPath(root: string, epic: number, story: number): string {
  return join(root, ".cadre", "state", `${epic}.${story}.json`);
}

function planPath(root: string): string {
  return join(root, ".cadre", "approvals", "plan.json");
}

/** Atomic-ish write (tmp + rename) so a concurrent reader never sees a torn file. */
async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await fsWriteFile(tmp, content);
  await rename(tmp, path);
}

/**
 * Write a story's authoritative Status to `.cadre/state/{epic}.{story}.json`,
 * byte-compatible with the Rust `StoryState` serialization ({ epic, story,
 * status }). The CLI is the sole writer in a headless run, so — unlike the Rust
 * store — it does not re-validate the transition graph; the engine only ever
 * asks for legal edges.
 */
export async function setStatus(
  root: string,
  epic: number,
  story: number,
  status: Status
): Promise<void> {
  const json = JSON.stringify({ epic, story, status }, null, 2);
  await atomicWrite(statusPath(root, epic, story), json);
}

/** Read a story's current Status, or `null` when it has no state file yet. */
export async function getStatus(root: string, epic: number, story: number): Promise<Status | null> {
  try {
    const raw = await fsReadFile(statusPath(root, epic, story), "utf8");
    return (JSON.parse(raw) as { status: Status }).status;
  } catch {
    return null;
  }
}

/** Read the PLAN approval (`.cadre/approvals/plan.json`), or `null` if unapproved. */
export async function getPlanApproval(root: string): Promise<PlanApproval | null> {
  try {
    const raw = await fsReadFile(planPath(root), "utf8");
    return JSON.parse(raw) as PlanApproval;
  } catch {
    return null;
  }
}

// ── Dep factories (member-for-member twins of tauriDeps' factories) ───────────

/** Run-story deps backed by Node. `onOutput` streams agent + verification output. */
export function nodeRunStoryDeps(root: string, onOutput?: OutputSink): RunStoryDeps {
  return {
    setStatus: (epic, story, status) => setStatus(root, epic, story, status),
    runGit,
    runGitQuery,
    spawnAgent: makeSpawnAgent(onOutput),
    waitForExit,
    runVerification: makeRunVerification(onOutput),
    killAgent,
  };
}

/** Orchestrator deps = run-story deps + the frozen PLAN-approval reader. */
export function nodeOrchestratorDeps(root: string, onOutput?: OutputSink): OrchestratorDeps {
  return { ...nodeRunStoryDeps(root, onOutput), getPlanApproval: () => getPlanApproval(root) };
}

/** Review-fleet deps: dispatch reviewer agent loops + read their findings markers. */
export function nodeReviewFleetDeps(onOutput?: OutputSink): ReviewFleetDeps {
  return {
    spawnAgent: makeSpawnAgent(onOutput),
    waitForExit,
    readFile,
  };
}
