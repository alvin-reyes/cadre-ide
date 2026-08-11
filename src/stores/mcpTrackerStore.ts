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
// Per-story in-flight promise map — serializes concurrent syncStory calls for
// the same story key so a second transition sees the taskId the first wrote,
// instead of racing to create a duplicate task.
// ---------------------------------------------------------------------------
const inflight = new Map<string, Promise<void>>();

const mcpTrackerPath = (root: string) => `${root}/.cadre/mcp-tracker.json`;

/** Read `.cadre/mcp-tracker.json`, tolerating a missing or malformed file by
 *  falling back to an empty tracker file owned by `serverKey`. */
async function readTrackerFile(root: string, serverKey: string): Promise<McpTrackerFile> {
  let raw: string | null = null;
  try {
    raw = await invoke<string>("read_file", { path: mcpTrackerPath(root) });
  } catch {
    raw = null;
  }
  if (raw === null) return emptyTrackerFile(serverKey);
  return trackerFromFile(raw) ?? emptyTrackerFile(serverKey);
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
   */
  syncStory(root: string, story: TrackerStory, status: TrackerStatus, verifyCmd?: string): Promise<void>;

  /** Test seam: replace the agent runner (default spawns a real `claude -p`). */
  __setRunSyncAgent(fn: RunSyncAgent): void;
}

export const useMcpTrackerStore = create<McpTrackerState>(() => ({
  syncStory: (root: string, story: TrackerStory, status: TrackerStatus, verifyCmd?: string): Promise<void> => {
    if (!shouldSync(status)) return Promise.resolve();

    const key = `${root}::${taskKey(story)}`;

    // Chain onto any in-flight promise for this exact story key so the
    // second call reads the taskId the first one wrote.
    const prev = inflight.get(key) ?? Promise.resolve();
    const next: Promise<void> = prev
      .then(async () => {
        try {
          const env = await useConnectionsStore.getState().resolveTrackerEnv(root);
          if (!env) return;

          const file = await readTrackerFile(root, env.serverKey);
          const storyKey = taskKey(story);
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
