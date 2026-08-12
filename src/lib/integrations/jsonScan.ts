/**
 * Pure JSON-scanning helpers — no Tauri, no Zustand, no SDK.
 * Shared by mcpTracker (parseSyncResult) and MCP inbound intake.
 */

/**
 * Find every top-level (outermost) balanced-brace `{...}` span in `raw`,
 * in order of appearance. Unlike a regex with fixed nesting depth, this
 * handles arbitrarily nested objects (e.g. `{"taskId":"T","meta":{"a":{"b":1}}}`)
 * by tracking brace depth. Braces inside JSON string literals (which may
 * contain `{`/`}` characters, e.g. in prose values) are ignored via a minimal
 * string-aware scan so they don't desync the depth count.
 */
export function findBalancedJsonObjects(raw: string): string[] {
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
 * Scan the balanced-brace candidates in `raw` from LAST to FIRST, `JSON.parse`
 * each in a try/catch, and return the first that parses AND satisfies `ok`
 * (default: is a non-null object). Returns null if none qualifies.
 */
export function lastJsonObject<T = unknown>(
  raw: string,
  ok: (v: unknown) => boolean = (v) => v != null && typeof v === "object",
): T | null {
  const candidates = findBalancedJsonObjects(raw);

  for (let i = candidates.length - 1; i >= 0; i--) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidates[i]);
    } catch {
      continue;
    }

    if (ok(parsed)) {
      return parsed as T;
    }
  }

  return null;
}
