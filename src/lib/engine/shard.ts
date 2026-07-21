/**
 * SM (Scrum Master) sharding (§6, create-next-story): turn an approved plan into
 * a fully-specified story file at `docs/stories/{epic}.{story}.{slug}.md`.
 *
 * The authoritative story Status is engine-owned JSON (`.cadre/state`), NOT the
 * markdown `## Status` — so the story file mainly carries CONTEXT for the Dev
 * agent (story, AC, tasks, dev notes). The Dev Agent Record + QA Results
 * sections are left empty for the agents to fill. Pure + DI: the only side
 * effect (writeFile) is injected, so the core is unit-testable with a fake.
 */

/**
 * The next story number within `epic`, given existing story ids like
 * ["1.1","1.2","2.1"] (e.g. epic 1 → 3, epic 3 → 1).
 */
export function nextStoryNumber(epic: number, existingIds: string[]): number {
  let max = 0;
  for (const id of existingIds) {
    const m = id.match(/^(\d+)\.(\d+)$/);
    if (!m) continue;
    if (Number(m[1]) !== epic) continue;
    const story = Number(m[2]);
    if (story > max) max = story;
  }
  return max + 1;
}

/** Slugify a title: lowercase, spaces/underscores → hyphens, strip non-url chars. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** `docs/stories/{epic}.{story}.{slug}.md` (slug is slugified). */
export function storyFilename(epic: number, story: number, slug: string): string {
  return `docs/stories/${epic}.${story}.${slugify(slug)}.md`;
}

export interface UserStory {
  role: string;
  action: string;
  benefit: string;
}

export interface StoryContent {
  epic: number;
  story: number;
  title: string;
  userStory: UserStory;
  acceptanceCriteria: string[];
  tasks: string[];
  devNotes: string;
}

/**
 * Render the BMAD story markdown (faithful to story-tmpl.yaml section titles).
 * Sections in order: title heading, Status (Draft), Story, Acceptance Criteria,
 * Tasks / Subtasks, Dev Notes, then empty Dev Agent Record + QA Results.
 */
export function composeStoryFile(input: StoryContent): string {
  const { epic, story, title, userStory, acceptanceCriteria, tasks, devNotes } =
    input;
  const parts: string[] = [];

  parts.push(`# Story ${epic}.${story}: ${title}`);
  parts.push("");
  parts.push("## Status");
  parts.push("");
  parts.push("Draft");
  parts.push("");
  parts.push("## Story");
  parts.push("");
  parts.push(`**As a** ${userStory.role},`);
  parts.push(`**I want** ${userStory.action},`);
  parts.push(`**so that** ${userStory.benefit}`);
  parts.push("");
  parts.push("## Acceptance Criteria");
  parts.push("");
  acceptanceCriteria.forEach((ac, i) => {
    parts.push(`${i + 1}. ${ac}`);
  });
  parts.push("");
  parts.push("## Tasks / Subtasks");
  parts.push("");
  for (const task of tasks) {
    parts.push(`- [ ] ${task}`);
  }
  parts.push("");
  parts.push("## Dev Notes");
  parts.push("");
  parts.push(devNotes);
  parts.push("");
  parts.push("## Dev Agent Record");
  parts.push("");
  parts.push("## QA Results");
  parts.push("");

  return parts.join("\n");
}

export interface ShardDeps {
  /** persist the story file (injected; in prod wraps Tauri write_text_file) */
  writeFile: (path: string, content: string) => Promise<void>;
}

export type ShardInput = StoryContent;

/**
 * Shard one story: compute its filename (storyFilename + slugified title),
 * compose the file, write it, and return the path.
 */
export async function shardStory(
  deps: ShardDeps,
  input: ShardInput
): Promise<{ path: string }> {
  const path = storyFilename(input.epic, input.story, input.title);
  const content = composeStoryFile(input);
  await deps.writeFile(path, content);
  return { path };
}
