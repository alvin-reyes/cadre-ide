import type { Status } from "./status";

/**
 * The Fleet board model + reconciler (§5, §3.8). The board is reconstructed
 * from disk — the engine-owned `.cadre/state/{epic}.{story}.json` files are the
 * authoritative Status, and `docs/stories/*.md` reveal which stories exist.
 * `reconcile` maps a single filesystem change into an updated board, so the UI
 * can be a pure function of committed files (reload-from-git, §3.8).
 *
 * This module is pure; the Tauri watcher subscription is thin glue elsewhere.
 */
export interface StoryCard {
  /** "epic.story", e.g. "1.2" */
  id: string;
  epic: number;
  story: number;
  title?: string;
  status: Status;
}

export interface BoardState {
  stories: Record<string, StoryCard>;
}

export function emptyBoard(): BoardState {
  return { stories: {} };
}

export function storyId(epic: number, story: number): string {
  return `${epic}.${story}`;
}

/** Stories in stable (epic, story) order. */
export function boardStories(board: BoardState): StoryCard[] {
  return Object.values(board.stories).sort(
    (a, b) => a.epic - b.epic || a.story - b.story
  );
}

export function applyStatus(
  board: BoardState,
  epic: number,
  story: number,
  status: Status
): BoardState {
  const id = storyId(epic, story);
  const existing = board.stories[id];
  const card: StoryCard = existing
    ? { ...existing, status }
    : { id, epic, story, status };
  return { stories: { ...board.stories, [id]: card } };
}

/** `docs/stories/{epic}.{story}.{slug}.md` */
export function parseStoryFilename(
  filename: string
): { epic: number; story: number; slug: string } | null {
  const m = filename.match(/^(\d+)\.(\d+)\.(.+)\.md$/);
  if (!m) return null;
  return { epic: Number(m[1]), story: Number(m[2]), slug: m[3] };
}

/** `.cadre/state/{epic}.{story}.json` */
export function parseStateFilename(
  filename: string
): { epic: number; story: number } | null {
  const m = filename.match(/^(\d+)\.(\d+)\.json$/);
  if (!m) return null;
  return { epic: Number(m[1]), story: Number(m[2]) };
}

function humanize(slug: string): string {
  return slug
    .replace(/[-_.]+/g, " ")
    .replace(/\bstory\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type WatchEvent =
  | { kind: "state"; filename: string; content: string }
  | { kind: "story"; filename: string };

/** Fold one filesystem change into the board (returns a new state). */
export function reconcile(board: BoardState, event: WatchEvent): BoardState {
  if (event.kind === "state") {
    const loc = parseStateFilename(event.filename);
    if (!loc) return board;
    let status: Status;
    try {
      status = (JSON.parse(event.content) as { status: Status }).status;
    } catch {
      return board; // ignore torn/partial writes
    }
    return applyStatus(board, loc.epic, loc.story, status);
  }

  // A story file appeared/changed — ensure a card exists, set its title.
  const loc = parseStoryFilename(event.filename);
  if (!loc) return board;
  const id = storyId(loc.epic, loc.story);
  const title = humanize(loc.slug);
  const existing = board.stories[id];
  if (existing) {
    return { stories: { ...board.stories, [id]: { ...existing, title } } };
  }
  return {
    stories: {
      ...board.stories,
      [id]: { id, epic: loc.epic, story: loc.story, title, status: "Draft" },
    },
  };
}
