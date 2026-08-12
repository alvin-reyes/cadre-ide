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
 */

import { execFile } from "node:child_process";

import {
  shouldSync,
  buildSyncPrompt,
  parseSyncResult,
  taskKey,
  trackerFromFile,
  trackerToFile,
  emptyTrackerFile,
  type TrackerStory,
  type TrackerStatus,
} from "../../lib/integrations/mcpTracker";
import type { NodeIo } from "./connectionsNode";

const mcpTrackerPath = (root: string) => `${root}/.cadre/mcp-tracker.json`;

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
        { cwd, env: { ...process.env, ...env }, maxBuffer: 16 * 1024 * 1024 },
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
 */
export async function syncStoryNode(
  io: NodeIo,
  root: string,
  story: TrackerStory,
  status: TrackerStatus,
  verifyCmd: string | undefined,
  deps: SyncStoryNodeDeps
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
