/**
 * Pure tracker-sync core — no Tauri, no Zustand, no SDK.
 * Builds sync intents, parses MCP responses, and manages tracker file state.
 */

export interface TrackerStory {
  epic: number;
  story: number;
  title: string;
  acceptanceCriteria?: string;
}

export type TrackerStatus =
  | "Draft"
  | "Approved"
  | "InProgress"
  | "InReview"
  | "Done"
  | "Failed"
  | "Blocked";

export interface SyncIntent {
  story: TrackerStory;
  status: TrackerStatus;
  verifyCmd?: string;
  existing?: { taskId: string; url?: string };
}

export interface McpTrackerFile {
  version: 1;
  connectionId: string;
  tasks: Record<string, { taskId: string; url?: string }>;
}

/**
 * Build task key from epic and story numbers.
 */
export function taskKey(s: { epic: number; story: number }): string {
  return `${s.epic}.${s.story}`;
}

/**
 * Determine if a status should trigger a sync.
 * Draft and Approved do not sync; all others do.
 */
export function shouldSync(status: TrackerStatus): boolean {
  return status !== "Draft" && status !== "Approved";
}

/**
 * Build a sync prompt for the tracker MCP.
 * Embeds story [epic.story], title, acceptance criteria, status, verify cmd, existing taskId.
 * Demands a JSON response with taskId and optional url.
 */
export function buildSyncPrompt(intent: SyncIntent): string {
  const key = taskKey(intent.story);
  const storyDesc = `[${key}] ${intent.story.title}`;

  let prompt = `You have access to tracker MCP tools. Ensure a task exists for: ${storyDesc}`;

  if (intent.story.acceptanceCriteria) {
    prompt += `\n\nAcceptance criteria: ${intent.story.acceptanceCriteria}`;
  }

  prompt += `\n\nSet the task status to: ${intent.status}`;

  if (intent.verifyCmd) {
    prompt += `\n\nAdd a comment: ✅ Verified by Cadre — \`${intent.verifyCmd}\` passed`;
  }

  if (intent.existing?.taskId) {
    prompt += `\n\nThe existing taskId is: ${intent.existing.taskId}. Update this task.`;
  } else {
    prompt += `\n\nCreate a new task.`;
  }

  prompt += `\n\nReply with ONLY a JSON object: {"taskId":"<id>","url":"<url>"} — nothing else.`;

  return prompt;
}

/**
 * Find every top-level (outermost) balanced-brace `{...}` span in `raw`,
 * in order of appearance. Unlike a regex with fixed nesting depth, this
 * handles arbitrarily nested objects (e.g. `{"taskId":"T","meta":{"a":{"b":1}}}`)
 * by tracking brace depth. Braces inside JSON string literals (which may
 * contain `{`/`}` characters, e.g. in prose values) are ignored via a minimal
 * string-aware scan so they don't desync the depth count.
 */
function findBalancedJsonObjects(raw: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          results.push(raw.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }

  return results;
}

/**
 * Parse a sync result from MCP response.
 * Scans for the LAST complete, top-level balanced-brace JSON object in the
 * string (handling arbitrary nesting depth), then requires it to parse as a
 * JSON object with a non-empty string `taskId`. Throws if no such object is
 * found.
 */
export function parseSyncResult(raw: string): { taskId: string; url?: string } {
  const candidates = findBalancedJsonObjects(raw);
  if (candidates.length === 0) {
    throw new Error("No JSON object found in sync result");
  }

  // Try candidates from last to first — the model's actual answer is
  // typically the final JSON block; earlier braces could be unrelated prose.
  let lastParseError: unknown = null;
  for (let i = candidates.length - 1; i >= 0; i--) {
    const jsonStr = candidates[i];
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      lastParseError = e;
      continue;
    }

    if (typeof parsed !== "object" || parsed === null) continue;

    const result = parsed as Record<string, unknown>;
    if (!result.taskId || typeof result.taskId !== "string" || result.taskId.trim() === "") continue;

    return {
      taskId: result.taskId,
      url: typeof result.url === "string" ? result.url : undefined,
    };
  }

  if (lastParseError) {
    throw new Error(`Failed to parse JSON from sync result: ${lastParseError}`);
  }
  throw new Error("Sync result missing or empty taskId");
}

/**
 * Serialize a tracker file to JSON string.
 */
export function trackerToFile(f: McpTrackerFile): string {
  return JSON.stringify(f);
}

/**
 * Parse a tracker file from JSON string.
 * Returns null if malformed or version is not 1.
 */
export function trackerFromFile(raw: string): McpTrackerFile | null {
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      parsed.version !== 1 ||
      typeof parsed.connectionId !== "string" ||
      typeof parsed.tasks !== "object" ||
      parsed.tasks === null
    ) {
      return null;
    }
    return parsed as McpTrackerFile;
  } catch {
    return null;
  }
}

/**
 * Create an empty tracker file for a connection.
 */
export function emptyTrackerFile(connectionId: string): McpTrackerFile {
  return {
    version: 1,
    connectionId,
    tasks: {},
  };
}
