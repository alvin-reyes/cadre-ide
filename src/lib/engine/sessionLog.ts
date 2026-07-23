/**
 * The session journal (`.cadre/session.md`): an append-only, on-disk record of what
 * the team has planned, built, and shipped. It's persisted so it survives restarts,
 * injected into every dispatched subagent (via loadSharedContext) so they know what's
 * already happened, and read by the Orchestrator so it has live project context.
 *
 * Pure helpers here (formatting, tailing) are unit-tested; the read/append glue takes
 * injected file deps so it stays testable and runtime-agnostic.
 */

export const SESSION_LOG_PATH = ".cadre/session.md";

export const SESSION_LOG_HEADER =
  "# Session journal\n\n" +
  "Append-only record of what this project has planned, built, and shipped. " +
  "Read this to understand the current state before acting.\n";

/** Compact UTC timestamp: `YYYY-MM-DD HH:MM`. Deterministic for a given ts. */
export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** One journal line: `- \`2026-07-24 04:35\` <event>`. */
export function renderSessionEntry(ts: number, event: string): string {
  return `- \`${formatTimestamp(ts)}\` ${event.trim()}`;
}

/**
 * Keep only the last `maxEntries` journal bullet lines (plus the header), so the file
 * injected into every agent's argv stays bounded. Non-bullet lines (the header block)
 * are preserved at the top.
 */
export function tailSessionLog(content: string, maxEntries = 60): string {
  const lines = content.split("\n");
  const bullets = lines.filter((l) => l.startsWith("- "));
  if (bullets.length <= maxEntries) return content.replace(/\s*$/, "") + "\n";
  const kept = bullets.slice(bullets.length - maxEntries);
  return `${SESSION_LOG_HEADER}\n_(older entries trimmed)_\n${kept.join("\n")}\n`;
}

export interface SessionLogDeps {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
}

/**
 * Append one event to the journal, seeding the header on first write and trimming the
 * file to a bounded tail. Tolerant of a missing file (treated as empty).
 */
export async function appendSessionEntry(
  deps: SessionLogDeps,
  root: string,
  ts: number,
  event: string
): Promise<void> {
  const path = `${root}/${SESSION_LOG_PATH}`;
  let existing = await deps.readFile(path).catch(() => "");
  if (!existing.trim()) existing = SESSION_LOG_HEADER;
  const line = renderSessionEntry(ts, event);
  const next = tailSessionLog(existing.replace(/\s*$/, "") + "\n" + line + "\n");
  await deps.writeFile(path, next);
}
