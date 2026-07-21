import { invoke, Channel } from "@tauri-apps/api/core";
import type { RunStoryDeps } from "./runStory";
import type { Status } from "./status";
import type { BmadFileReader } from "../bmad/adapter";
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

async function spawnAgent(opts: {
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
}

function waitForExit(ptyId: number): Promise<{ exitCode: number | null }> {
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

async function runVerification(
  cwd: string,
  command: string,
  timeoutSecs: number
): Promise<{ exitCode: number | null; timedOut: boolean }> {
  const res = await invoke<RustRunResult>("run_verification", {
    cwd,
    cmd: command,
    timeoutSecs,
  });
  return { exitCode: res.exit_code, timedOut: res.timed_out };
}

async function setStatus(
  epic: number,
  story: number,
  status: Status
): Promise<void> {
  await invoke("story_set_status", { epic, story, status });
}

/** The full set of engine deps backed by Tauri. */
export function tauriRunStoryDeps(): RunStoryDeps {
  return { setStatus, runGit, spawnAgent, waitForExit, runVerification };
}

/** A BmadFileReader that reads `${projectRoot}/.bmad-core/<relPath>` via Tauri. */
export function tauriBmadReader(projectRoot: string): BmadFileReader {
  return (relPath) =>
    invoke<string>("read_file", { path: `${projectRoot}/.bmad-core/${relPath}` });
}
