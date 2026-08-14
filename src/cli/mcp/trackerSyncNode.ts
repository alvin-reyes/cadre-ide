/**
 * Node twin of `src/stores/mcpTrackerStore.ts`'s `syncStory` — same pure core
 * (`src/lib/integrations/mcpTracker.ts`), Node I/O (`NodeIo`) instead of Tauri
 * `invoke`, and a headless `claude -p` agent (via `child_process.execFile`)
 * instead of a spawned PTY. `cadre run` is sequential (one story dispatched at
 * a time), so — unlike the store — no per-project in-flight promise chain is
 * needed to serialize concurrent syncs against the shared tracker file.
 *
 * Sync is downstream of truth: any failure here (resolve, read, agent, parse,
 * write) is logged and swallowed — it must never fail `cadre run`.
 *
 * Unlike the desktop store's fire-and-forget sync, the CLI AWAITS each sync in
 * the sequential run loop — so it is BOUNDED: `realRunSyncAgentNode` caps the
 * headless `claude` agent with a hard timeout (a hung MCP tool must never stall
 * the whole run; a timeout rejects → syncStoryNode logs a warning and returns).
 * The bounded round-trip per transition is a deliberate divergence for the CLI.
 */

import { execFile } from "node:child_process";

import {
  shouldSync,
  buildSyncPrompt,
  buildEpicSyncPrompt,
  parseSyncResult,
  taskKey,
  trackerFromFile,
  trackerToFile,
  emptyTrackerFile,
  epicTicket,
  aggregateEpicStatus,
  type TrackerStory,
  type TrackerStatus,
} from "../../lib/integrations/mcpTracker";
import { AGENT_TIMEOUT_MS } from "../../lib/integrations/agentTimeout";
import type { Status } from "../../lib/engine/status";
import type { NodeIo } from "./connectionsNode";

const mcpTrackerPath = (root: string) => `${root}/.cadre/mcp-tracker.json`;

// Hard cap on a single headless sync agent — shared `AGENT_TIMEOUT_MS` (2 min,
// generous for a 1-2 tool-call sync incl. npx MCP server spin-up). On timeout,
// execFile kills the child (SIGKILL) and rejects; the rejection is caught by
// syncStoryNode's outer try/catch → logged warning, no hang, never thrown out
// of the run.

// ---------------------------------------------------------------------------
// Injectable agent runner
// ---------------------------------------------------------------------------

export type RunSyncAgentNode = (args: {
  prompt: string;
  mcpConfigPath: string;
  env: Record<string, string>;
  serverKey: string;
  cwd: string;
}) => Promise<string>;

/** Real implementation: a headless `claude -p` agent scoped to ONLY the
 *  tracker's MCP tools (least privilege — no Bash, no
 *  --dangerously-skip-permissions), capturing stdout. */
export function realRunSyncAgentNode(): RunSyncAgentNode {
  return ({ prompt, mcpConfigPath, env, serverKey, cwd }) =>
    new Promise((resolve, reject) => {
      execFile(
        "claude",
        ["-p", prompt, "--mcp-config", mcpConfigPath, "--allowedTools", `mcp__${serverKey}__*`],
        {
          cwd,
          env: { ...process.env, ...env },
          maxBuffer: 16 * 1024 * 1024,
          timeout: AGENT_TIMEOUT_MS,
          killSignal: "SIGKILL",
        },
        (err, stdout, stderr) => {
          if (err) {
            reject(new Error(`sync agent exited non-zero: ${String(stderr || err).trim()}`));
            return;
          }
          resolve(String(stdout));
        }
      );
    });
}

// ---------------------------------------------------------------------------
// syncStoryNode
// ---------------------------------------------------------------------------

export interface SyncStoryNodeDeps {
  resolveTrackerEnv: (
    io: NodeIo,
    root: string
  ) => Promise<{ mcpConfigPath: string; env: Record<string, string>; serverKey: string } | null>;
  runSyncAgent: RunSyncAgentNode;
}

/**
 * Sync a single story's status to the MCP tracker via a headless agent.
 * No-op when the status doesn't warrant a sync or no tracker connection
 * resolves. Never throws — any failure is logged (no secret values) and
 * swallowed so a tracker hiccup can never fail `cadre run`.
 *
 * When the story's epic is linked to a parent ticket (`epicTicket`) AND
 * `epicStatuses` is supplied, the sync targets the PARENT ticket instead of
 * creating/updating a per-story task: the epic's aggregate status (from ALL
 * of `epicStatuses` filtered to this story's epic) is pushed to the linked
 * ticket, and no per-story `file.tasks[key]` entry is written (the file is
 * not written at all on this path). If the epic has no linked ticket, or
 * `epicStatuses` is omitted (back-compat), the original per-story sync path
 * runs unchanged.
 */
export async function syncStoryNode(
  io: NodeIo,
  root: string,
  story: TrackerStory,
  status: TrackerStatus,
  verifyCmd: string | undefined,
  deps: SyncStoryNodeDeps,
  epicStatuses?: { epic: number; story: number; status: TrackerStatus }[]
): Promise<void> {
  if (!shouldSync(status)) return;

  try {
    const env = await deps.resolveTrackerEnv(io, root);
    if (!env) return;

    const path = mcpTrackerPath(root);

    // ENOENT-only-vs-abort read discipline (matches mcpTrackerStore.ts's I1
    // fix): a genuinely-missing file → start from empty; ANY other read
    // failure (permissions, transient I/O) or a present-but-malformed file
    // MUST abort without writing — falling back to emptyTrackerFile here
    // would silently drop every other story's id when the write lands.
    let file: ReturnType<typeof emptyTrackerFile>;
    try {
      const raw = await io.readFile(path);
      if (raw === null) {
        file = emptyTrackerFile(env.serverKey);
      } else {
        const parsed = trackerFromFile(raw);
        if (parsed === null) {
          console.error("cadre: tracker sync skipped — .cadre/mcp-tracker.json is present but malformed");
          return;
        }
        file = parsed;
      }
    } catch (e) {
      console.error(`cadre: tracker sync skipped — could not read .cadre/mcp-tracker.json: ${String(e)}`);
      return;
    }

    const key = taskKey(story);

    // Parent-ticket routing: when this story's epic is linked to a ticket AND
    // the caller supplied the full epic status set, sync the AGGREGATE epic
    // status to the PARENT ticket instead of a per-story task. No per-story
    // `file.tasks[key]` entry is written on this path — the parent ticket IS
    // the record for the whole epic.
    const ticket = epicTicket(file, story.epic);
    if (ticket && epicStatuses) {
      const forEpic = epicStatuses.filter((s) => s.epic === story.epic).map((s) => s.status);
      const agg = aggregateEpicStatus(forEpic);
      if (!agg) return;

      const prompt = buildEpicSyncPrompt({
        ticketId: ticket.ticketId,
        aggregateStatus: agg,
        changedStory: key,
        changedStatus: status,
        doneCount: forEpic.filter((s) => s === "Done").length,
        totalCount: forEpic.length,
        verifyCmd,
      });

      const raw = await deps.runSyncAgent({
        prompt,
        mcpConfigPath: env.mcpConfigPath,
        env: env.env,
        serverKey: env.serverKey,
        cwd: root,
      });
      // Validates a taskId came back; the parent-ticket file already has the
      // link, so nothing needs to be written back.
      parseSyncResult(raw);
      return;
    }

    const existing = file.tasks[key];
    const prompt = buildSyncPrompt({ story, status, verifyCmd, existing });

    const raw = await deps.runSyncAgent({
      prompt,
      mcpConfigPath: env.mcpConfigPath,
      env: env.env,
      serverKey: env.serverKey,
      cwd: root,
    });
    const { taskId, url } = parseSyncResult(raw);

    file.tasks[key] = { taskId, url };
    await io.writeFile(path, trackerToFile(file));
  } catch (e) {
    // Sync is downstream of truth — never let a tracker failure propagate.
    console.error(`cadre: tracker sync failed: ${String(e)}`);
  }
}

// ---------------------------------------------------------------------------
// setStatus wrapper — sync at the engine's REAL transition points
// ---------------------------------------------------------------------------

/**
 * Wrap an engine `setStatus` so each REAL story transition also syncs the
 * tracker — the CLI equivalent of the desktop hooking `bmadStore.setStatus`.
 *
 * The authoritative engine write runs FIRST; the sync runs only AFTER it
 * resolves. Two invariants fall out of that ordering:
 *   - A transition the story never reaches is never reported. If the engine
 *     throws BEFORE it calls setStatus (e.g. runApprovedStory's per-repo verify
 *     gate rejecting before dispatch), this wrapper is simply never invoked, so
 *     nothing syncs — no stuck "InProgress".
 *   - If the authoritative write itself throws, the sync does not run, so the
 *     tracker is never set to a status the engine failed to persist.
 * `syncTransition` (backed by syncStoryNode) never throws, so wrapping the
 * engine dep can never break the run.
 */
export function syncingSetStatus(
  baseSetStatus: (epic: number, story: number, status: Status) => Promise<void>,
  syncTransition: (epic: number, story: number, status: Status) => Promise<void>
): (epic: number, story: number, status: Status) => Promise<void> {
  return async (epic, story, status) => {
    await baseSetStatus(epic, story, status);
    await syncTransition(epic, story, status);
  };
}
