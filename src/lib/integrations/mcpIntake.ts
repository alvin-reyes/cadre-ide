/**
 * Pure core for inbound tracker intake — no Zustand, no Tauri, no SDK.
 * Reused by CLI and desktop via MCP tools.
 */

import { lastJsonObject } from "./jsonScan";

export interface FetchedTicket {
  id: string;
  title: string;
  description?: string;
  acceptanceCriteria?: string;
  url?: string;
}

/**
 * Build an instruction prompt for fetching a ticket via MCP tools.
 * Demands read-only access, names the ticket ref, and enforces strict JSON response format.
 */
export function buildFetchPrompt(ticketRef: string): string {
  return (
    `You have read-only access to a tracker via MCP tools. ` +
    `Fetch the ticket/issue with id/key \`${ticketRef}\`. ` +
    `Do NOT modify anything. ` +
    `Reply with ONLY a JSON object: ` +
    `{"id":"…","title":"…","description":"…","acceptanceCriteria":"…","url":"…"} ` +
    `(omit unknown optional fields).`
  );
}

/**
 * Helper: check if a value is a non-empty string.
 */
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/**
 * Parse a ticket from raw MCP response text.
 * Uses lastJsonObject to find the JSON object, then validates and extracts known fields.
 * Throws if missing required id or title fields.
 */
export function parseTicket(raw: string): FetchedTicket {
  const parsed = lastJsonObject<Record<string, unknown>>(raw, (v) => {
    if (v == null || typeof v !== "object") return false;
    const obj = v as Record<string, unknown>;
    return isNonEmptyString(obj.id) && isNonEmptyString(obj.title);
  });

  if (!parsed) {
    throw new Error("No valid JSON ticket found with required id and title");
  }

  // Return only the known fields
  const ticket: FetchedTicket = {
    id: parsed.id as string,
    title: parsed.title as string,
  };

  // Add optional fields if they exist and are non-empty strings
  if (isNonEmptyString(parsed.description)) {
    ticket.description = parsed.description;
  }
  if (isNonEmptyString(parsed.acceptanceCriteria)) {
    ticket.acceptanceCriteria = parsed.acceptanceCriteria;
  }
  if (isNonEmptyString(parsed.url)) {
    ticket.url = parsed.url;
  }

  return ticket;
}

/**
 * Convert a FetchedTicket to a Markdown brief.
 * Includes title, description, acceptance criteria (if any), and provenance footer.
 */
export function ticketToBrief(ticket: FetchedTicket): string {
  let brief = `# ${ticket.title}\n\n`;

  if (ticket.description) {
    brief += `${ticket.description}\n\n`;
  }

  if (ticket.acceptanceCriteria) {
    brief += `## Acceptance criteria\n\n${ticket.acceptanceCriteria}\n\n`;
  }

  brief += `_Imported from tracker ${ticket.id}._`;

  return brief;
}
