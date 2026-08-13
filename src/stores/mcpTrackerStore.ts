/**
 * mcpTrackerStore — agent-mediated sync of story status to an MCP-backed
 * tracker (Jira/ClickUp/Trello/...). Delegates the actual create/update to a
 * headless `claude -p` agent scoped to ONLY the tracker connection's MCP
 * tools (least privilege — no Bash, no --dangerously-skip-permissions), then
 * persists the returned taskId/url so subsequent transitions update the same
 * task instead of creating a duplicate.
 *
 * Sync is downstream of truth: any failure here is reported (toast + AI Log)
 * and swallowed — it must never block or corrupt the story's own state.
 */
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import {
  shouldSync,
  buildSyncPrompt,
  parseSyncResult,
  taskKey,
  trackerFromFile,
  emptyTrackerFile,
  trackerToFile,
  epicTicket,
  aggregateEpicStatus,
  buildEpicSyncPrompt,
  type TrackerStory,
  type TrackerStatus,
  type McpTrackerFile,
} from "../lib/integrations/mcpTracker";
import { useConnectionsStore } from "./connectionsStore";
import { tauriOrchestratorDeps, waitForExit } from "../lib/engine/tauriDeps";
import { reportError } from "../lib/reportError";

// ---------------------------------------------------------------------------
// Injectable agent runner
// ---------------------------------------------------------------------------

export type RunSyncAgent = (args: {
  prompt: string;
  mcpConfigPath: string;
  env: Record<string, string>;
  serverKey: string;
  cwd: string;
}) => Promise<string>;

/** Real implementation: spawn a headless `claude -p` agent with ONLY the
 *  tracker's MCP tools allowed. Mirrors evaluationStore.runAgent's
 *  spawn+capture+waitForExit pattern. */
const defaultRunSyncAgent: RunSyncAgent = async ({ prompt, mcpConfigPath, env, serverKey, cwd }) => {
  let out = "";
  const deps = tauriOrchestratorDeps(cwd, (chunk) => {
    out += chunk;
  });
  const ptyId = await deps.spawnAgent({
    command: "claude",
    args: ["--allowedTools", `mcp__${serverKey}__*`, "--mcp-config", mcpConfigPath, "-p", prompt],
    cwd,
    env,
  });
  await waitForExit(ptyId);
  return out;
};

// Test seam: replaced via __setRunSyncAgent. Module-level (not store state) so
// it survives outside the zustand snapshot, same shape as trackerStore's
// module-level `inflight` map.
let runSyncAgent: RunSyncAgent = defaultRunSyncAgent;

// ---------------------------------------------------------------------------
// Per-PROJECT in-flight promise map — serializes ALL concurrent syncStory
// calls for a project (across different stories), not just same-story ones.
// The read-modify-write targets a single shared `.cadre/mcp-tracker.json`, so
// two different stories syncing concurrently would otherwise interleave: story
// B's write could land between story A's read and A's write, dropping A's
// just-persisted taskId and causing a spurious duplicate task on A's next
// sync. Keying per-root makes every update to the shared file atomic. Sync is
// best-effort / non-latency-critical, so strict serialization is fine.
// ---------------------------------------------------------------------------
const inflight = new Map<string, Promise<void>>();

const mcpTrackerPath = (root: string) => `${root}/.cadre/mcp-tracker.json`;

/** True when a `read_file` rejection string indicates the file genuinely
 *  doesn't exist (Tauri's `read_file` command rejects with a string error;
 *  see src-tauri/src/lib.rs `read_file`, which formats
 *  `std::fs::read_to_string` errors as `Failed to read {path}: {os error}`).
 *  Anything else (permission denied, transient I/O, etc.) is NOT a
 *  not-found error and must not be treated as "file absent".
 *  Exported so other stores writing the same `.cadre/mcp-tracker.json` file
 *  (e.g. mcpIntakeStore's `recordEpicLinkFor`) share this exact ENOENT
 *  detection rather than re-deriving it. */
export function isFileNotFoundError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  const lower = msg.toLowerCase();
  return lower.includes("no such file or directory") || lower.includes("os error 2");
}

/** Sentinel thrown by readTrackerFile when the read failed for a reason
 *  OTHER than the file being genuinely absent (transient I/O, permissions,
 *  malformed-but-present file). Callers must abort the sync without writing
 *  — falling back to `emptyTrackerFile` here would silently drop every other
 *  story's id when the write lands, per FIX I1. */
class TrackerReadAbort extends Error {}

/** Read `.cadre/mcp-tracker.json`, tolerating ONLY a genuinely-missing file
 *  by falling back to an empty tracker file owned by `serverKey`. Any other
 *  read failure (transient I/O, permissions) or a malformed-but-present file
 *  throws TrackerReadAbort — the caller must abort the sync rather than
 *  overwrite a file that may hold other stories' task ids. */
async function readTrackerFile(root: string, serverKey: string): Promise<McpTrackerFile> {
  let raw: string;
  try {
    raw = await invoke<string>("read_file", { path: mcpTrackerPath(root) });
  } catch (e) {
    if (isFileNotFoundError(e)) return emptyTrackerFile(serverKey);
    throw new TrackerReadAbort(`mcp tracker: read failed (not a missing-file error): ${String(e)}`);
  }
  const parsed = trackerFromFile(raw);
  if (parsed === null) {
    throw new TrackerReadAbort("mcp tracker: existing file is present but malformed");
  }
  return parsed;
}

async function writeTrackerFile(root: string, file: McpTrackerFile): Promise<void> {
  await invoke("write_text_file", { path: mcpTrackerPath(root), content: trackerToFile(file) });
}

// ---------------------------------------------------------------------------
// Zustand store
// ---------------------------------------------------------------------------

interface McpTrackerState {
  /**
   * Sync a single story's status to the MCP tracker via an agent.
   * No-op when the status doesn't warrant a sync or no tracker connection is
   * resolvable. Best-effort: errors are routed to reportError, never thrown.
   *
   * When the story's epic is linked to a parent ticket (`epicTicket`) AND
   * `epicStatuses` is supplied, the sync targets the PARENT ticket instead of
   * creating/updating a per-story task: the epic's aggregate status (from
   * ALL of `epicStatuses` filtered to this story's epic) is pushed to the
   * linked ticket, and no per-story task entry is written. If the epic has no
   * linked ticket, or `epicStatuses` is omitted (back-compat), the original
   * per-story sync path runs unchanged.
   */
  syncStory(
    root: string,
    story: TrackerStory,
    status: TrackerStatus,
    verifyCmd?: string,
    epicStatuses?: { epic: number; story: number; status: TrackerStatus }[],
  ): Promise<void>;

  /** Test seam: replace the agent runner (default spawns a real `claude -p`). */
  __setRunSyncAgent(fn: RunSyncAgent): void;
}

export const useMcpTrackerStore = create<McpTrackerState>(() => ({
  syncStory: (
    root: string,
    story: TrackerStory,
    status: TrackerStatus,
    verifyCmd?: string,
    epicStatuses?: { epic: number; story: number; status: TrackerStatus }[],
  ): Promise<void> => {
    if (!shouldSync(status)) return Promise.resolve();

    // One serialization chain per PROJECT (not per story): every sync for this
    // root updates the same shared `.cadre/mcp-tracker.json`, so they must run
    // strictly sequentially to keep each read-modify-write atomic.
    const key = root;

    // Chain onto any in-flight promise for this project so the next call reads
    // the file state (taskIds) the previous call just wrote.
    const prev = inflight.get(key) ?? Promise.resolve();
    const next: Promise<void> = prev
      .then(async () => {
        try {
          const env = await useConnectionsStore.getState().resolveTrackerEnv(root);
          if (!env) return;

          const file = await readTrackerFile(root, env.serverKey);
          const storyKey = taskKey(story);

          // Parent-ticket routing: when this story's epic is linked to a
          // ticket AND the caller supplied the full epic status set, sync the
          // AGGREGATE epic status to the PARENT ticket instead of a per-story
          // task. No per-story `tasks[storyKey]` entry is written on this
          // path — the parent ticket IS the record for the whole epic.
          const ticket = epicTicket(file, story.epic);
          if (ticket && epicStatuses) {
            const forEpic = epicStatuses.filter((s) => s.epic === story.epic).map((s) => s.status);
            const agg = aggregateEpicStatus(forEpic);
            if (!agg) return;

            const prompt = buildEpicSyncPrompt({
              ticketId: ticket.ticketId,
              epic: story.epic,
              aggregateStatus: agg,
              changedStory: storyKey,
              changedStatus: status,
              doneCount: forEpic.filter((s) => s === "Done").length,
              totalCount: forEpic.length,
              verifyCmd,
            });
            const raw = await runSyncAgent({
              prompt,
              mcpConfigPath: env.mcpConfigPath,
              env: env.env,
              serverKey: env.serverKey,
              cwd: root,
            });
            // Validates a taskId came back; the parent-ticket file already
            // has the link, so nothing needs to be written back.
            parseSyncResult(raw);
            return;
          }

          const existing = file.tasks[storyKey];

          const prompt = buildSyncPrompt({ story, status, verifyCmd, existing });
          const raw = await runSyncAgent({
            prompt,
            mcpConfigPath: env.mcpConfigPath,
            env: env.env,
            serverKey: env.serverKey,
            cwd: root,
          });
          const { taskId, url } = parseSyncResult(raw);

          file.tasks[storyKey] = { taskId, url };
          await writeTrackerFile(root, file);
        } catch (e) {
          // Sync is downstream of truth — never let a tracker failure
          // propagate past this store.
          reportError("mcp tracker: sync", e);
        }
      })
      .finally(() => {
        // Only clear our own entry — a newer call may have already replaced it.
        if (inflight.get(key) === next) {
          inflight.delete(key);
        }
      });

    inflight.set(key, next);
    return next;
  },

  __setRunSyncAgent: (fn: RunSyncAgent) => {
    runSyncAgent = fn;
  },
}));
