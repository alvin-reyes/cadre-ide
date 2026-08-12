/**
 * Pure tracker-sync core — no Tauri, no Zustand, no SDK.
 * Builds sync intents, parses MCP responses, and manages tracker file state.
 */

import { findBalancedJsonObjects, lastJsonObject } from "./jsonScan";

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
  epics?: Record<string, { ticketId: string; url?: string }>;
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
 * Parse a sync result from MCP response.
 * Scans for the LAST complete, top-level balanced-brace JSON object in the
 * string (handling arbitrary nesting depth, string-aware) that parses as a
 * JSON object with a non-empty string `taskId`. Throws if no such object is
 * found.
 */
export function parseSyncResult(raw: string): { taskId: string; url?: string } {
  const result = lastJsonObject<Record<string, unknown>>(
    raw,
    (v) => typeof (v as any)?.taskId === "string" && (v as any).taskId.trim() !== "",
  );

  if (!result) {
    if (findBalancedJsonObjects(raw).length === 0) {
      throw new Error("No JSON object found in sync result");
    }
    throw new Error("Sync result missing or empty taskId");
  }

  return {
    taskId: result.taskId as string,
    url: typeof result.url === "string" ? result.url : undefined,
  };
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
 * Normalizes missing `epics` key to `{}` for back-compat with v1 files that predate epics support.
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
    // Normalize missing epics to empty object (back-compat)
    if (!parsed.epics) {
      parsed.epics = {};
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
    epics: {},
  };
}

/**
 * Record an epic↔ticket link in the tracker file.
 * Returns a new file with the epic link stored, preserving existing tasks and epics.
 * Immutable — does not mutate the input.
 */
export function recordEpicLink(
  file: McpTrackerFile,
  epic: number,
  link: { ticketId: string; url?: string },
): McpTrackerFile {
  const epics = file.epics ?? {};
  return {
    ...file,
    epics: {
      ...epics,
      [String(epic)]: link,
    },
  };
}

/**
 * Retrieve an epic↔ticket link from the tracker file.
 * Returns undefined if the epic is not found.
 */
export function epicTicket(
  file: McpTrackerFile,
  epic: number,
): { ticketId: string; url?: string } | undefined {
  return file.epics?.[String(epic)];
}
