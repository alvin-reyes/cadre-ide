/**
 * Agent-keyed Claude session ids (`.cadre/team-sessions.json`).
 *
 * Each agent slot in the persistent team pool keeps its own session, allowing
 * it to carry codebase context across the tasks it picks up.  After `resetK`
 * tasks the session is discarded and a fresh one is minted so context windows
 * don't balloon indefinitely.
 *
 * Pure map helpers are unit-tested; the read/modify/write glue takes injected
 * file deps (no Tauri / Zustand / React imports).
 */

export const TEAM_SESSIONS_PATH = ".cadre/team-sessions.json";

export interface AgentSession {
  sessionId: string;
  taskCount: number;
}

/** agentId → AgentSession */
export type AgentSessionMap = Record<string, AgentSession>;

// ---------------------------------------------------------------------------
// Parse / serialize
// ---------------------------------------------------------------------------

/** Tolerant parse — a missing/corrupt file or non-object value yields {}, never throws. */
export function parseAgentSessions(json: string): AgentSessionMap {
  try {
    const v = JSON.parse(json);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: AgentSessionMap = {};
    for (const [k, val] of Object.entries(v)) {
      if (
        val !== null &&
        typeof val === "object" &&
        !Array.isArray(val) &&
        typeof (val as Record<string, unknown>).sessionId === "string" &&
        (val as Record<string, unknown>).sessionId !== "" &&
        typeof (val as Record<string, unknown>).taskCount === "number"
      ) {
        out[k] = {
          sessionId: (val as Record<string, unknown>).sessionId as string,
          taskCount: (val as Record<string, unknown>).taskCount as number,
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Pretty JSON with a trailing newline (mirrors `serializeSessionMap`). */
export function serializeAgentSessions(map: AgentSessionMap): string {
  return JSON.stringify(map, null, 2) + "\n";
}

// ---------------------------------------------------------------------------
// Pure decision
// ---------------------------------------------------------------------------

/**
 * Given the current map entry for an agent (or `undefined` if absent) and the
 * session-reset threshold `resetK`, decide whether to resume the existing
 * session or start fresh.
 *
 * Rules:
 *  - `entry` undefined → fresh  (taskCount starts at 1)
 *  - `entry.taskCount < resetK` → resume, increment taskCount
 *  - `entry.taskCount >= resetK` → fresh (new id, taskCount back to 1)
 */
export function decideAgentSession(
  entry: AgentSession | undefined,
  resetK: number,
  newId: string
): { sessionId: string; resume: boolean; next: AgentSession } {
  if (entry !== undefined && entry.taskCount < resetK) {
    // Resume path
    const next: AgentSession = {
      sessionId: entry.sessionId,
      taskCount: entry.taskCount + 1,
    };
    return { sessionId: entry.sessionId, resume: true, next };
  }

  // Fresh path — either no prior entry or threshold reached
  const next: AgentSession = { sessionId: newId, taskCount: 1 };
  return { sessionId: newId, resume: false, next };
}

// ---------------------------------------------------------------------------
// Read / modify / write glue
// ---------------------------------------------------------------------------

export interface SessionStoreDeps {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
}

/**
 * Resolve the session for an agent slot:
 *  1. Read + parse `${root}/${TEAM_SESSIONS_PATH}` (tolerant on error).
 *  2. Call `decideAgentSession` for this `agentId`.
 *  3. Persist the updated map entry back to disk.
 *  4. Return `{ sessionId, resume }`.
 */
export async function resolveAgentSession(
  deps: SessionStoreDeps,
  root: string,
  agentId: string,
  resetK: number,
  genId: () => string
): Promise<{ sessionId: string; resume: boolean }> {
  const path = `${root}/${TEAM_SESSIONS_PATH}`;
  const raw = await deps.readFile(path).catch(() => "");
  const map = parseAgentSessions(raw);

  const { sessionId, resume, next } = decideAgentSession(
    map[agentId],
    resetK,
    genId()
  );

  map[agentId] = next;
  await deps.writeFile(path, serializeAgentSessions(map));

  return { sessionId, resume };
}
