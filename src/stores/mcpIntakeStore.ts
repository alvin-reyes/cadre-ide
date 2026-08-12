/**
 * mcpIntakeStore — desktop side of inbound tracker intake ("Import from
 * tracker"). Fetches a single ticket via a headless, least-privilege
 * `claude -p` agent scoped to ONLY the designated tracker connection's MCP
 * tools (mirrors mcpTrackerStore's outbound sync spawn), parses it, and
 * hands the caller a FetchedTicket to pre-fill the plan composer with.
 *
 * Never throws: any failure (no tracker designated, spawn failure, malformed
 * response) is routed through reportError (toast + AI Log) and resolves to
 * null so the UI never needs its own try/catch around fetchTicket.
 */
import { create } from "zustand";
import { buildFetchPrompt, parseTicket, type FetchedTicket } from "../lib/integrations/mcpIntake";
import { useConnectionsStore } from "./connectionsStore";
import { tauriOrchestratorDeps, waitForExit } from "../lib/engine/tauriDeps";
import { reportError } from "../lib/reportError";

// ---------------------------------------------------------------------------
// Injectable agent runner
// ---------------------------------------------------------------------------

export type RunFetchAgent = (args: {
  prompt: string;
  mcpConfigPath: string;
  env: Record<string, string>;
  serverKey: string;
  cwd: string;
}) => Promise<string>;

// Upper bound on how long a single ticket fetch may run before we give up —
// matches the CLI fetch path's execFile timeout. fetchTicket is AWAITED behind
// an interactive control (importing:true disables the input+button), so an
// unbounded hang would leave the Import button stuck spinning with no recovery.
const FETCH_AGENT_TIMEOUT_MS = 120_000;

/** Reject with `label` if `p` doesn't settle within `ms`, always clearing the
 *  timer so no dangling handle survives when `p` wins the race. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** Real implementation: spawn a headless `claude -p` agent with ONLY the
 *  tracker's MCP tools allowed. Mirrors mcpTrackerStore's defaultRunSyncAgent
 *  spawn+capture+waitForExit pattern, but bounds the wait so a hung agent or
 *  MCP server can't wedge the caller — on timeout we kill the pty (so the
 *  spawned process doesn't leak) and throw. */
const defaultRunFetchAgent: RunFetchAgent = async ({ prompt, mcpConfigPath, env, serverKey, cwd }) => {
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
  try {
    await withTimeout(waitForExit(ptyId), FETCH_AGENT_TIMEOUT_MS, "intake: fetch agent timed out");
  } catch (e) {
    // Kill the pty so a timed-out `claude`/MCP process doesn't linger.
    await deps.killAgent?.(ptyId).catch(() => {});
    throw e;
  }
  return out;
};

// Test seam: replaced via __setRunFetchAgent. Module-level (not store state)
// so it survives outside the zustand snapshot, same shape as
// mcpTrackerStore's module-level `runSyncAgent`.
let runFetchAgent: RunFetchAgent = defaultRunFetchAgent;

// ---------------------------------------------------------------------------
// Zustand store
// ---------------------------------------------------------------------------

interface McpIntakeState {
  /** True while a fetch is in flight — drives the Import button's spinner. */
  importing: boolean;

  /**
   * Fetch a single ticket from the designated tracker by ref/id. Returns null
   * on ANY failure (already reportError'd) — never throws.
   */
  fetchTicket(root: string, ticketRef: string): Promise<FetchedTicket | null>;

  /** Test seam: replace the agent runner (default spawns a real `claude -p`). */
  __setRunFetchAgent(fn: RunFetchAgent): void;
}

export const useMcpIntakeStore = create<McpIntakeState>((set) => ({
  importing: false,

  fetchTicket: async (root: string, ticketRef: string): Promise<FetchedTicket | null> => {
    set({ importing: true });
    try {
      const env = await useConnectionsStore.getState().resolveTrackerEnv(root);
      if (!env) {
        reportError("intake: no tracker connection designated", "No tracker connection is designated for this project — set one in Connections.");
        return null;
      }

      // Bound the wait around the runFetchAgent call itself (not only inside
      // defaultRunFetchAgent) so a hung agent of ANY implementation still
      // fails-closed here — the rejection lands in the catch below (reportError
      // + null) and the finally resets importing, so the Import button can't
      // stay stuck spinning.
      const raw = await withTimeout(
        runFetchAgent({
          prompt: buildFetchPrompt(ticketRef),
          mcpConfigPath: env.mcpConfigPath,
          env: env.env,
          serverKey: env.serverKey,
          cwd: root,
        }),
        FETCH_AGENT_TIMEOUT_MS,
        "intake: fetch agent timed out",
      );

      return parseTicket(raw);
    } catch (e) {
      reportError("intake: fetch failed", e);
      return null;
    } finally {
      set({ importing: false });
    }
  },

  __setRunFetchAgent: (fn: RunFetchAgent) => {
    runFetchAgent = fn;
  },
}));
