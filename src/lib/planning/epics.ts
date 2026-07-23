/**
 * Parse the PRD's "## Epics" section into a list of epics, so the fleet can shard
 * stories per epic (epic.story numbering) instead of a flat epic-1 pile. Pure and
 * tolerant of the common markdown shapes the PM emits (headings, bullets, numbers,
 * "Epic N:" prefixes). Sub-bullets (indented) are treated as detail, not epics.
 */
export interface Epic {
  number: number;
  title: string;
}

export function parseEpics(prd: string): Epic[] {
  // Capture the "## Epics" body until the next h1/h2 heading or end of string.
  // (No /m flag — we want $ to mean end-of-string, not end-of-line.)
  const section = prd.match(/(?:^|\n)##\s*Epics?\b[^\n]*\n([\s\S]*?)(?=\n#{1,2}\s|$)/i);
  if (!section) return [];

  const epics: Epic[] = [];
  for (const raw of section[1].split("\n")) {
    if (/^\s{2,}/.test(raw)) continue; // indented → sub-detail of an epic, not an epic
    const line = raw.trim();
    if (!line) continue;
    // Only real epic entries: a heading, bullet, or numbered item.
    if (!/^(#{2,6}\s|[-*]\s|\d+[.)]\s)/.test(line)) continue;
    const title = line
      .replace(/^#{1,6}\s*/, "")
      .replace(/^[-*]\s*/, "")
      .replace(/^\d+[.)]\s*/, "")
      .replace(/^epic\s*\d+\s*[:\-–]\s*/i, "")
      .replace(/^\*\*(.+?)\*\*/, "$1") // unwrap bold
      .trim();
    if (title) epics.push({ number: epics.length + 1, title });
  }
  return epics;
}
