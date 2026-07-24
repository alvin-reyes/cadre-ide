/**
 * mockBackend.ts — Demo mode Tauri command backend.
 *
 * Installs a fake `window.__TAURI_INTERNALS__` so that all existing
 * `invoke(...)` calls in the app run against in-memory fakes when in demo mode.
 *
 * GUARD: no-op if running outside a browser OR if a real __TAURI_INTERNALS__
 * already exists (don't clobber real Tauri).
 *
 * Task 2 will fill in the PTY/agent commands — stubs are marked with TODO(Task 2).
 */

import type { MockFs } from "./mockFs";
import type { PlanApproval } from "../engine/planApproval";
import type { Status } from "../engine/status";
import { canTransition } from "../engine/transitions";

// ─── Callback registry (for transformCallback / unregisterCallback) ────────────

let cbSeq = 0;
const callbackMap = new Map<number, (...args: unknown[]) => unknown>();

function transformCallback(cb: (...args: unknown[]) => unknown, _once?: boolean): number {
  const id = ++cbSeq;
  callbackMap.set(id, cb);
  return id;
}

function unregisterCallback(id: number): void {
  callbackMap.delete(id);
}

function convertFileSrc(path: string): string {
  return path;
}

// ─── PTY stub state (Task 2 will expand) ──────────────────────────────────────

let ptySeq = 0;
const ptyCwds = new Map<number, string>();

// ─── Secrets store (in-memory, round-trips Settings) ─────────────────────────

const secretsStore = new Map<string, string>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

/** Write a file and implicitly create parent dirs (no-op since MockFs is flat). */
function writeWithParents(fs: MockFs, path: string, content: string): void {
  fs.write(path, content);
}

function stateFilePath(root: string, epic: number, story: number): string {
  return `${root}/.cadre/state/${epic}.${story}.json`;
}

// ─── Main command dispatcher ──────────────────────────────────────────────────

function makeInvoke(fs: MockFs) {
  return async function invoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
    switch (cmd) {
      // ── File system ───────────────────────────────────────────────────────

      case "read_file": {
        const path = args.path as string;
        const content = fs.read(path);
        if (content === null) {
          throw new Error(`[demo] read_file: file not found: ${path}`);
        }
        return content;
      }

      case "read_file_base64": {
        const path = args.path as string;
        const content = fs.read(path);
        if (content === null) {
          throw new Error(`[demo] read_file_base64: file not found: ${path}`);
        }
        // Encode UTF-8 string as base64
        return btoa(unescape(encodeURIComponent(content)));
      }

      case "write_text_file": {
        const path = args.path as string;
        const content = (args.content ?? args.contents ?? "") as string;
        writeWithParents(fs, path, content);
        return null;
      }

      case "create_directory": {
        const path = args.path as string;
        fs.mkdir(path);
        return null;
      }

      case "list_directory": {
        const path = args.path as string;
        return fs.list(path);
      }

      case "list_md_files": {
        const dir = (args.dir as string) || "/";
        // Return all .md files under dir
        return fs.allPaths().filter((p) => p.startsWith(dir) && p.endsWith(".md"));
      }

      case "save_temp_image": {
        // Return a fake temp image path
        const name = basename((args.path as string | undefined) ?? "image.png");
        return `/tmp/cadre-demo/${name}`;
      }

      case "search_in_files": {
        const root = args.root as string;
        const query = args.query as string;
        const caseSensitive = (args.caseSensitive as boolean) ?? false;
        const results: Array<{ path: string; matches: Array<{ line: number; col: number; count: number; preview: string }> }> = [];
        for (const [filePath, content] of fs.entries()) {
          if (!filePath.startsWith(root)) continue;
          const lines = content.split("\n");
          const matches: Array<{ line: number; col: number; count: number; preview: string }> = [];
          lines.forEach((lineText, i) => {
            const hay = caseSensitive ? lineText : lineText.toLowerCase();
            const needle = caseSensitive ? query : query.toLowerCase();
            let col = hay.indexOf(needle);
            let count = 0;
            while (col !== -1) {
              count++;
              col = hay.indexOf(needle, col + 1);
            }
            const firstCol = hay.indexOf(needle);
            if (count > 0) {
              matches.push({ line: i + 1, col: firstCol, count, preview: lineText.slice(0, 120) });
            }
          });
          if (matches.length > 0) results.push({ path: filePath, matches });
        }
        return results;
      }

      case "replace_in_files": {
        const root = args.root as string;
        const query = args.query as string;
        const replacement = args.replacement as string;
        const caseSensitive = (args.caseSensitive as boolean) ?? false;
        let filesChanged = 0;
        let totalReplacements = 0;
        for (const [filePath, content] of fs.entries()) {
          if (!filePath.startsWith(root)) continue;
          const flags = caseSensitive ? "g" : "gi";
          const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
          const next = content.replace(re, replacement);
          if (next !== content) {
            fs.write(filePath, next);
            filesChanged++;
            totalReplacements += (content.match(re) ?? []).length;
          }
        }
        return { files_changed: filesChanged, replacements: totalReplacements };
      }

      // ── Project/state ─────────────────────────────────────────────────────

      case "open_project": {
        return null;
      }

      case "story_set_status": {
        const root = args.root as string;
        const epic = args.epic as number;
        const story = args.story as number;
        const status = args.status as Status;

        const stateFile = stateFilePath(root, epic, story);
        const existing = fs.read(stateFile);
        const currentStatus: Status = existing ? (JSON.parse(existing).status as Status) : "Draft";

        if (!canTransition(currentStatus, status)) {
          throw new Error(`[demo] illegal status transition: ${currentStatus} -> ${status}`);
        }

        writeWithParents(fs, stateFile, JSON.stringify({ status }, null, 2));
        return null;
      }

      case "story_get_status": {
        const root = args.root as string;
        const epic = args.epic as number;
        const story = args.story as number;
        const stateFile = stateFilePath(root, epic, story);
        const content = fs.read(stateFile);
        if (!content) return "Draft";
        return (JSON.parse(content) as { status: Status }).status;
      }

      case "is_own_write": {
        // In demo mode, all writes are "own writes" — suppress watcher echoes.
        return true;
      }

      case "approve_plan": {
        const root = args.root as string;
        const verification = args.verification as string[];
        const repoVerification = args.repoVerification as Record<string, string[]> | undefined;
        const approval: PlanApproval = {
          approved: true,
          verification,
          ...(repoVerification ? { repoVerification } : {}),
        };
        writeWithParents(fs, `${root}/.cadre/plan-approval.json`, JSON.stringify(approval, null, 2));
        return null;
      }

      case "get_plan_approval": {
        const root = args.root as string;
        const content = fs.read(`${root}/.cadre/plan-approval.json`);
        if (!content) return null;
        return JSON.parse(content) as PlanApproval;
      }

      // ── Exec ─────────────────────────────────────────────────────────────

      case "run_git": {
        return { exit_code: 0, stdout: "", stderr: "", timed_out: false };
      }

      case "run_verification": {
        return { exit_code: 0, stdout: "mock: all checks passed", stderr: "", timed_out: false };
      }

      case "run_gh": {
        return { exit_code: 0, stdout: '{"number":1}', stderr: "", timed_out: false };
      }

      // ── Secrets ──────────────────────────────────────────────────────────

      case "secret_get": {
        const key = args.key as string;
        return secretsStore.get(key) ?? null;
      }

      case "secret_set": {
        const key = args.key as string;
        const value = args.value as string;
        secretsStore.set(key, value);
        return null;
      }

      case "secret_has": {
        const key = args.key as string;
        return secretsStore.has(key);
      }

      case "secret_delete": {
        const key = args.key as string;
        secretsStore.delete(key);
        return null;
      }

      // ── Env / probes ──────────────────────────────────────────────────────

      case "check_command_exists": {
        return true;
      }

      case "check_claude_plugin": {
        return true;
      }

      case "claude_auth_status": {
        return true;
      }

      case "get_pty_cwd": {
        const id = args.id as number;
        return ptyCwds.get(id) ?? "";
      }

      // ── Watchers ─────────────────────────────────────────────────────────

      case "watch_directory": {
        // No-op: demo drives state directly; no real fs events needed.
        return null;
      }

      case "unwatch_directory": {
        return null;
      }

      // ── Dialog plugin ─────────────────────────────────────────────────────

      case "plugin:dialog|open": {
        // Return a fixed demo project path so folder-picker works.
        return "/demo/cadre-demo-project";
      }

      // ── PTY stubs (TODO: Task 2 fills these in) ───────────────────────────

      case "create_pty": {
        // TODO(Task 2): stream a realistic build transcript via the Channel.
        const id = ++ptySeq;
        const cwd = (args.cwd as string | undefined) ?? "";
        ptyCwds.set(id, cwd);
        return id;
      }

      case "write_pty": {
        // TODO(Task 2): feed input to the mock agent.
        return null;
      }

      case "resize_pty": {
        // TODO(Task 2): resize the mock terminal.
        return null;
      }

      case "reattach_pty": {
        // TODO(Task 2): reconnect to an existing mock PTY session.
        return null;
      }

      case "kill_pty": {
        // TODO(Task 2): cancel the active PTY transcript timer and emit exit.
        const id = args.id as number;
        ptyCwds.delete(id);
        return null;
      }

      // ── Unmapped fallback ─────────────────────────────────────────────────

      default: {
        console.warn("[demo] unhandled invoke:", cmd, args);
        return null;
      }
    }
  };
}

// ─── Install ─────────────────────────────────────────────────────────────────

/**
 * Install the mock Tauri backend.
 *
 * Guards:
 * - No-op if not in a browser (`typeof window === "undefined"`).
 * - No-op if a real __TAURI_INTERNALS__ already exists (don't clobber real Tauri).
 */
export function installMockBackend(fs: MockFs): void {
  if (typeof window === "undefined") return;
  if ("__TAURI_INTERNALS__" in window) return;

  const invoke = makeInvoke(fs);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__TAURI_INTERNALS__ = {
    invoke,
    transformCallback,
    unregisterCallback,
    convertFileSrc,
  };
}
