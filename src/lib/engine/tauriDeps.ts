import { invoke, Channel } from "@tauri-apps/api/core";
import type { RunStoryDeps } from "./runStory";
import type { OrchestratorDeps } from "./orchestrator";
import type { ReviewFleetDeps } from "./reviewFleet";
import type { PlanApproval } from "./planApproval";
import type { Status } from "./status";
import type { ResolveDeps } from "./resolveConflict";
import { ExitRegistry } from "./exitRegistry";

/**
 * Production implementations of the engine's injected dependencies, backed by
 * the Rust Tauri commands. The engine logic (runStory/verifyStory/dispatchStory)
 * stays pure and tested; this module is the thin, runtime-only glue.
 */

type PtyEvent =
  | { type: "output"; data: number[] }
  | { type: "exit"; code: number | null }
  | { type: "error"; message: string };

interface RustRunResult {
  exit_code: number | null;
  stdout: string;
  stderr: string;
  timed_out: boolean;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

// Per-PTY exit tracking (fixes the fast-agent exit-code race, #3).
const exits = new ExitRegistry();

const textDecoder = new TextDecoder();
function decodePtyData(data: number[]): string {
  return textDecoder.decode(new Uint8Array(data));
}

/** Sink for streamed agent/verification output (wired to the Fleet agent pane). */
export type OutputSink = (chunk: string) => void;

function makeSpawnAgent(onOutput?: OutputSink) {
  return async function spawnAgent(opts: {
    command: string;
    args: string[];
    cwd: string;
    env?: Record<string, string>;
  }): Promise<number> {
    const idReady = deferred<number>();

    const channel = new Channel<PtyEvent>();
    channel.onmessage = (event) => {
      if (event.type === "exit") {
        idReady.promise.then((id) => exits.resolve(id, event.code));
      } else if (event.type === "output" && onOutput) {
        onOutput(decodePtyData(event.data));
      } else if (event.type === "error" && onOutput) {
        onOutput(`\n[pty error] ${event.message}\n`);
      }
    };

    const id = await invoke<number>("create_pty", {
      rows: 24,
      cols: 80,
      cwd: opts.cwd,
      command: opts.command,
      args: opts.args,
      env: opts.env,
      onEvent: channel,
    });

    exits.register(id);
    idReady.resolve(id);
    return id;
  };
}

export function waitForExit(ptyId: number): Promise<{ exitCode: number | null }> {
  return exits.wait(ptyId);
}

async function runGit(args: string[], cwd: string): Promise<void> {
  const res = await invoke<RustRunResult>("run_git", { cwd, args });
  if (res.exit_code !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (exit ${res.exit_code}): ${res.stderr.trim()}`
    );
  }
}

/** Non-throwing variant — returns exit code + stdout without throwing on non-zero.
 * Used when a non-zero exit is expected (e.g. a conflicting merge). */
async function runGitQuery(
  args: string[],
  cwd: string
): Promise<{ exitCode: number | null; stdout: string }> {
  const res = await invoke<RustRunResult>("run_git", { cwd, args });
  return { exitCode: res.exit_code, stdout: res.stdout };
}

function makeRunVerification(onOutput?: OutputSink) {
  return async function runVerification(
    cwd: string,
    command: string,
    timeoutSecs: number
  ): Promise<{ exitCode: number | null; timedOut: boolean }> {
    if (onOutput) onOutput(`\n$ ${command}\n`);
    const res = await invoke<RustRunResult>("run_verification", {
      cwd,
      cmd: command,
      timeoutSecs,
    });
    if (onOutput) {
      if (res.stdout) onOutput(res.stdout);
      if (res.stderr) onOutput(res.stderr);
      onOutput(
        res.timed_out
          ? "\n[verification timed out]\n"
          : `\n[verification exit ${res.exit_code}]\n`
      );
    }
    return { exitCode: res.exit_code, timedOut: res.timed_out };
  };
}

async function setStatus(
  root: string,
  epic: number,
  story: number,
  status: Status
): Promise<void> {
  await invoke("story_set_status", { root, epic, story, status });
}

async function getPlanApproval(root: string): Promise<PlanApproval | null> {
  return invoke<PlanApproval | null>("get_plan_approval", { root });
}

/** The full set of engine deps backed by Tauri. Pass `onOutput` to stream the
 * agent's PTY output and verification output to the UI. */
export function tauriRunStoryDeps(root: string, onOutput?: OutputSink): RunStoryDeps {
  return {
    setStatus: (epic, story, status) => setStatus(root, epic, story, status),
    runGit,
    runGitQuery,
    spawnAgent: makeSpawnAgent(onOutput),
    waitForExit,
    runVerification: makeRunVerification(onOutput),
    killAgent: (ptyId: number) => invoke("kill_pty", { id: ptyId }).then(() => {}),
  };
}

/** Orchestrator deps (run-story deps + the PLAN approval reader). */
export function tauriOrchestratorDeps(root: string, onOutput?: OutputSink): OrchestratorDeps {
  return { ...tauriRunStoryDeps(root, onOutput), getPlanApproval: () => getPlanApproval(root) };
}

/** Review-fleet deps: dispatch reviewer agent loops + read their findings markers. */
export function tauriReviewFleetDeps(onOutput?: OutputSink): ReviewFleetDeps {
  return {
    spawnAgent: makeSpawnAgent(onOutput),
    waitForExit,
    readFile: (path: string) => invoke<string>("read_file", { path }),
  };
}

/** Merge-conflict resolver deps backed by Tauri. Pass `onOutput` to stream
 * the resolver agent's PTY output and re-verification output to the UI. */
export function tauriResolveConflictDeps(onOutput?: OutputSink): ResolveDeps {
  return {
    runGit,
    runGitQuery,
    spawnAgent: makeSpawnAgent(onOutput),
    waitForExit,
    killAgent: (id: number) => invoke("kill_pty", { id }).then(() => {}),
    runVerification: makeRunVerification(onOutput),
  };
}
