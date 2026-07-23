/**
 * Parallel-execution scheduling for the fleet. Stories run as concurrent Dev
 * agents in isolated git worktrees, but two agents editing the SAME file would
 * collide on integration. So we group stories into sequential BATCHES where each
 * batch can run fully in parallel: no two stories in a batch share a declared
 * file. Batches run one after another; stories within a batch run concurrently.
 *
 * A story that declares NO files can't be proven isolated, so it runs alone
 * (its own batch) — conservative, but it never causes a surprise conflict.
 */

export interface SchedulableStory {
  id: string;
  /** files the story is expected to touch (from the SM's declaration) */
  files: string[];
}

/** Normalize a declared path so "./a", "/a", " a " all compare equal. */
export function normalizeFile(f: string): string {
  return f.trim().replace(/^\.\//, "").replace(/^\/+/, "");
}

/**
 * Group stories into parallel-safe batches (greedy first-fit, input order
 * preserved). `cap` bounds how many agents run at once (batch size).
 */
export function scheduleParallel(stories: SchedulableStory[], cap = 4): string[][] {
  const limit = Math.max(1, Math.floor(cap)); // never strand every story on a bad cap
  const batches: { ids: string[]; files: Set<string>; sealed: boolean }[] = [];

  for (const s of stories) {
    const files = (s.files ?? []).map(normalizeFile).filter(Boolean);
    const unknown = files.length === 0;
    let placed = false;

    if (!unknown) {
      for (const b of batches) {
        if (b.sealed || b.ids.length >= limit) continue;
        if (files.some((f) => b.files.has(f))) continue; // would collide
        files.forEach((f) => b.files.add(f));
        b.ids.push(s.id);
        placed = true;
        break;
      }
    }
    // Unknown-files stories (and anything that didn't fit) start a fresh batch;
    // an unknown-files batch is sealed so nothing else joins it.
    if (!placed) batches.push({ ids: [s.id], files: new Set(files), sealed: unknown });
  }

  return batches.map((b) => b.ids);
}
