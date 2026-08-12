/** Append any of `lines` not already present (exact-line match) to gitignore
 *  content. Tolerates empty/missing content. Returns the new content and whether
 *  anything changed (so a caller can skip a no-op write). Pure. */
export function mergeGitignore(existing: string, lines: string[]): { content: string; changed: boolean } {
  const existingLines = new Set(existing.split("\n").map((l) => l.trim()));
  const missing = lines.filter((l) => !existingLines.has(l));
  if (missing.length === 0) {
    return { content: existing, changed: false };
  }
  const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  const content = existing + sep + missing.join("\n") + "\n";
  return { content, changed: true };
}
