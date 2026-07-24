/**
 * Pool-pull assignment strategy for the persistent team-pool dispatch loop.
 *
 * Given the stories that are ready to run, the files currently being modified
 * by in-flight assignments, and how many agent slots are free, returns the
 * subset of ready stories that can start NOW — file-disjoint from each other
 * and from every in-flight file.
 *
 * Stories with NO declared files are conservative: they run alone (only when
 * nothing is already in flight AND nothing else has been picked for this
 * round). This mirrors schedule.ts's sealed-batch rule.
 */

export interface ReadyStory {
  id: string;
  /** files already repo-namespaced (as dispatchReady produces them) */
  files: string[];
}

/**
 * Return the ready stories that can start now: file-disjoint from
 * `inFlightFiles` AND from each other, up to `freeSlots`, in input order.
 *
 * Greedy first-fit:
 * - Seed a running `used` set from `inFlightFiles`.
 * - Walk `ready` in order.
 * - Take a story if ALL its files are absent from `used`.
 * - A no-files story (files.length === 0) is conservative: take it ONLY if
 *   `used` is still equal to `inFlightFiles` (i.e. nothing has been picked
 *   yet in this round) AND `inFlightFiles` is empty. Once taken, mark a
 *   sentinel so nothing else is appended.
 * - When taken, add its files to `used`.
 * - Stop when `freeSlots` picks have been made.
 *
 * Inputs are never mutated.
 */
export function pickAssignable(
  ready: ReadyStory[],
  inFlightFiles: Set<string>,
  freeSlots: number
): ReadyStory[] {
  if (freeSlots <= 0 || ready.length === 0) return [];

  // Working copy of the in-flight set — never mutates the caller's set.
  const used = new Set(inFlightFiles);
  const picks: ReadyStory[] = [];
  // Sentinel: once a no-files story is picked, block everything else.
  let blocked = false;

  for (const story of ready) {
    if (picks.length >= freeSlots) break;
    if (blocked) break;

    const { files } = story;

    if (files.length === 0) {
      // Conservative: only run alone, and only when nothing is in flight at
      // all (used still empty, meaning inFlightFiles was empty AND no other
      // stories have been picked yet for this round).
      if (used.size === 0) {
        picks.push(story);
        blocked = true; // nothing else may join
      }
      // else: skip — something is already in flight or already picked
      continue;
    }

    // Normal story: check all files are disjoint from used.
    if (files.some((f) => used.has(f))) continue;

    // Take it.
    files.forEach((f) => used.add(f));
    picks.push(story);
  }

  return picks;
}
