/**
 * Pure ADR (Architecture Decision Record) model.
 *
 * ADRs live at `.cadre/context/decisions/NNNN-slug.md`.
 * This module is pure: no Tauri, no zustand, no React, no Date().
 * The caller supplies the `date` field.
 */

import { slugify } from "./shard";

export const ADR_DECISIONS_DIR = ".cadre/context/decisions";

export type AdrStatus = "Proposed" | "Accepted" | "Superseded";

export interface Adr {
  number: number;
  title: string;
  status: AdrStatus;
  /** YYYY-MM-DD — caller supplies; keeps module pure */
  date: string;
  context: string;
  decision: string;
  consequences: string;
}

/**
 * Return the full path for an ADR file.
 * e.g. adrFilename(2, "Use Postgres") → ".cadre/context/decisions/0002-use-postgres.md"
 */
export function adrFilename(number: number, title: string): string {
  const padded = String(number).padStart(4, "0");
  const slug = slugify(title);
  return `${ADR_DECISIONS_DIR}/${padded}-${slug}.md`;
}

/**
 * Return the next ADR number: max(existing) + 1, or 1 when the list is empty.
 */
export function nextAdrNumber(existingNumbers: number[]): number {
  return Math.max(0, ...existingNumbers) + 1;
}

/**
 * Render an ADR as standard ADR markdown.
 *
 * Format:
 * ```
 * # {n}. {title}
 *
 * _Date: {date}_
 *
 * ## Status
 *
 * {status}
 *
 * ## Context
 *
 * {context}
 *
 * ## Decision
 *
 * {decision}
 *
 * ## Consequences
 *
 * {consequences}
 * ```
 */
export function composeAdr(adr: Adr): string {
  const parts: string[] = [];

  parts.push(`# ${adr.number}. ${adr.title}`);
  parts.push("");
  parts.push(`_Date: ${adr.date}_`);
  parts.push("");
  parts.push("## Status");
  parts.push("");
  parts.push(adr.status);
  parts.push("");
  parts.push("## Context");
  parts.push("");
  parts.push(adr.context);
  parts.push("");
  parts.push("## Decision");
  parts.push("");
  parts.push(adr.decision);
  parts.push("");
  parts.push("## Consequences");
  parts.push("");
  parts.push(adr.consequences);
  parts.push("");

  return parts.join("\n");
}

/**
 * Extract the text of a section delimited by `## {heading}`.
 * Returns the trimmed content between that heading and the next `##`/`#` or end-of-file.
 *
 * NOTE: Do NOT use the `m` flag here — with `m`, `$` matches end-of-line (always
 * true), which causes the lazy `[\s\S]*?` to collapse to empty.  Instead we use
 * `(?:^|\n)` to anchor the heading and rely on `$` meaning end-of-string.
 */
function extractSection(markdown: string, heading: string): string {
  const re = new RegExp(
    `(?:^|\\n)##\\s*${heading}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|\\n#\\s|$)`
  );
  const m = markdown.match(re);
  return m ? m[1].trim() : "";
}

/**
 * Parse an ADR markdown string back into an `Adr` object.
 * Returns `null` if the markdown is not a valid ADR (no `# {n}. {title}` heading).
 */
export function parseAdr(markdown: string): Adr | null {
  // Match heading: "# 2. Use Postgres"
  const titleMatch = markdown.match(/^#\s+(\d+)\.\s+(.+)$/m);
  if (!titleMatch) return null;

  const number = Number(titleMatch[1]);
  const title = titleMatch[2].trim();

  // Parse date from "_Date: YYYY-MM-DD_"
  const dateMatch = markdown.match(/_Date:\s*([^_\n]+)_/);
  const date = dateMatch ? dateMatch[1].trim() : "";

  // Parse status — first non-empty line in ## Status section
  const rawStatus = extractSection(markdown, "Status");
  const status = (rawStatus || "Proposed") as AdrStatus;

  const context = extractSection(markdown, "Context");
  const decision = extractSection(markdown, "Decision");
  const consequences = extractSection(markdown, "Consequences");

  return { number, title, status: status as AdrStatus, date, context, decision, consequences };
}

/**
 * Parse a list of filenames into `{ number, slug }` entries, sorted by number.
 * Files that don't match `NNNN-slug.md` are silently ignored.
 */
export function parseAdrIndex(
  filenames: string[]
): { number: number; slug: string }[] {
  const results: { number: number; slug: string }[] = [];
  const re = /^(\d+)-(.+)\.md$/;

  for (const filename of filenames) {
    const m = filename.match(re);
    if (!m) continue;
    results.push({ number: Number(m[1]), slug: m[2] });
  }

  return results.sort((a, b) => a.number - b.number);
}
