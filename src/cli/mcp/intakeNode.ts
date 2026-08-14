/**
 * Node twin of inbound tracker INTAKE — the pure core lives in
 * `src/lib/integrations/mcpIntake.ts` (`buildFetchPrompt`, `parseTicket`,
 * `ticketToBrief`); this module supplies the headless `claude -p` agent (via
 * `child_process.execFile`) and the Node I/O (`NodeIo`) wiring, mirroring
 * `trackerSyncNode.ts`'s `realRunSyncAgentNode` shape (same bounded spawn,
 * same timeout, same least-privilege `--allowedTools mcp__<serverKey>__*`
 * allowlist — no Bash, no `--dangerously-skip-permissions`).
 *
 * INTAKE IS LOUD — the opposite of sync. `syncStoryNode` is downstream of
 * truth: it swallows every failure so a tracker hiccup never fails `cadre
 * run`. `fetchTicketNode` is upstream of a brand-new plan: there is nothing
 * yet to protect, so no tracker connection, a failing/timing-out fetch
 * agent, or an unparsable reply all THROW and propagate — `cadre intake`
 * catches at the CLI boundary and exits non-zero rather than silently
 * producing a bogus or empty brief.
 */

import { execFile } from "node:child_process";

import { buildFetchPrompt, parseTicket, type FetchedTicket } from "../../lib/integrations/mcpIntake";
import { AGENT_TIMEOUT_MS } from "../../lib/integrations/agentTimeout";
import { resolveTrackerEnvNode, type NodeIo } from "./connectionsNode";

// Hard cap on a single headless fetch agent — shared `AGENT_TIMEOUT_MS` (2
// min, generous for a 1-2 tool-call fetch incl. npx MCP server spin-up). On
// timeout, execFile kills the child (SIGKILL) and rejects; `fetchTicketNode`
// lets that rejection propagate — intake is loud.

// ---------------------------------------------------------------------------
// Injectable agent runner
// ---------------------------------------------------------------------------

export type RunFetchAgentNode = (args: {
  prompt: string;
  mcpConfigPath: string;
  env: Record<string, string>;
  serverKey: string;
  cwd: string;
}) => Promise<string>;

/** Real implementation: a headless `claude -p` agent scoped to ONLY the
 *  tracker's MCP tools (least privilege — no Bash, no
 *  --dangerously-skip-permissions), capturing stdout. Same spawn shape as
 *  `trackerSyncNode.ts`'s `realRunSyncAgentNode`, parallelled here rather
 *  than shared since the two modules are otherwise independent. */
export function realRunFetchAgentNode(): RunFetchAgentNode {
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
            reject(new Error(`fetch agent exited non-zero: ${String(stderr || err).trim()}`));
            return;
          }
          resolve(String(stdout));
        }
      );
    });
}

// ---------------------------------------------------------------------------
// fetchTicketNode
// ---------------------------------------------------------------------------

export interface FetchTicketNodeDeps {
  resolveTrackerEnv?: (
    io: NodeIo,
    root: string
  ) => Promise<{ mcpConfigPath: string; env: Record<string, string>; serverKey: string } | null>;
  runFetchAgent?: RunFetchAgentNode;
}

/**
 * Fetch a single ticket from the designated tracker MCP connection via a
 * headless agent and parse it into a `FetchedTicket`.
 *
 * LOUD by design: THROWS (does not swallow) when no tracker connection is
 * designated, when the fetch agent fails or times out, or when its reply
 * doesn't parse into a valid ticket. The CLI (`cmdIntake`) is responsible
 * for catching and turning that into a clean exit-1.
 */
export async function fetchTicketNode(
  io: NodeIo,
  root: string,
  ticketRef: string,
  deps: FetchTicketNodeDeps = {}
): Promise<FetchedTicket> {
  const resolveTrackerEnv = deps.resolveTrackerEnv ?? resolveTrackerEnvNode;
  const runFetchAgent = deps.runFetchAgent ?? realRunFetchAgentNode();

  const env = await resolveTrackerEnv(io, root);
  if (!env) {
    throw new Error("no tracker connection designated — cadre connect <preset> --as-tracker");
  }

  const prompt = buildFetchPrompt(ticketRef);
  const raw = await runFetchAgent({
    prompt,
    mcpConfigPath: env.mcpConfigPath,
    env: env.env,
    serverKey: env.serverKey,
    cwd: root,
  });

  return parseTicket(raw);
}
