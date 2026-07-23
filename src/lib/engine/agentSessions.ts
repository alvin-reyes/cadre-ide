/**
 * Per-story Claude session ids (`.cadre/agent-sessions.json`), so a re-dispatch of a
 * Failed/Blocked story can `claude -p --resume <id>` and keep the prior attempt's
 * conversation context instead of starting cold. The first dispatch mints a session id
 * (passed via `--session-id`); every later dispatch of the same story resumes it.
 *
 * Pure map helpers are unit-tested; the read/modify/write glue takes injected file deps.
 */

export const AGENT_SESSIONS_PATH = ".cadre/agent-sessions.json";

export type SessionMap = Record<string, string>; // "epic.story" -> claude session id

/** Tolerant parse — a missing/corrupt file yields an empty map, never throws. */
export function parseSessionMap(json: string): SessionMap {
  try {
    const v = JSON.parse(json);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: SessionMap = {};
    for (const [k, val] of Object.entries(v)) {
      if (typeof val === "string" && val) out[k] = val;
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeSessionMap(map: SessionMap): string {
  return JSON.stringify(map, null, 2) + "\n";
}

export interface SessionStoreDeps {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
}

export interface ResolvedSession {
  sessionId: string;
  /** true → resume an existing session (retry); false → a freshly minted one. */
  resume: boolean;
}

/**
 * Resolve the session for a story: reuse (and resume) a recorded id if one exists,
 * otherwise mint a new id via `genId`, persist it, and mark it fresh.
 */
export async function resolveStorySession(
  deps: SessionStoreDeps,
  root: string,
  storyKey: string,
  genId: () => string
): Promise<ResolvedSession> {
  const path = `${root}/${AGENT_SESSIONS_PATH}`;
  const map = parseSessionMap(await deps.readFile(path).catch(() => ""));
  const existing = map[storyKey];
  if (existing) return { sessionId: existing, resume: true };
  const sessionId = genId();
  map[storyKey] = sessionId;
  await deps.writeFile(path, serializeSessionMap(map));
  return { sessionId, resume: false };
}
