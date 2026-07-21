import type { StoryContent } from "../engine/shard";

/**
 * The Anthropic tool the SM persona uses to emit a fully-specified story
 * (BMAD `create-next-story`). Structured output → validated → fed to
 * `shardStory` (shard.ts). The dev notes must be complete enough that the Dev
 * agent never needs to read the architecture docs.
 */
export const CREATE_STORY_TOOL = {
  name: "create_story",
  description:
    "Emit one fully-specified, context-engineered story for a Dev agent to implement. Populate every field; the Dev agent works only from this.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short story title" },
      role: { type: "string", description: "As a <role>" },
      action: { type: "string", description: "I want <action>" },
      benefit: { type: "string", description: "so that <benefit>" },
      acceptanceCriteria: {
        type: "array",
        items: { type: "string" },
        description: "Testable acceptance criteria",
      },
      tasks: {
        type: "array",
        items: { type: "string" },
        description: "Implementation tasks/subtasks (TDD-first)",
      },
      devNotes: {
        type: "string",
        description:
          "All context the Dev agent needs (relevant architecture, source tree, standards) so it never reads other docs.",
      },
    },
    required: ["title", "role", "action", "benefit", "acceptanceCriteria", "tasks", "devNotes"],
  },
} as const;

function reqStr(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`create_story: missing or empty "${name}"`);
  }
  return value;
}

function strList(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`create_story: "${name}" must be a list`);
  }
  return value.filter((x): x is string => typeof x === "string");
}

/** Validate + map a `create_story` tool call into a StoryContent for sharding. */
export function storyContentFromTool(
  input: unknown,
  epic: number,
  story: number
): StoryContent {
  const i = (input ?? {}) as Record<string, unknown>;
  return {
    epic,
    story,
    title: reqStr(i.title, "title"),
    userStory: {
      role: reqStr(i.role, "role"),
      action: reqStr(i.action, "action"),
      benefit: reqStr(i.benefit, "benefit"),
    },
    acceptanceCriteria: strList(i.acceptanceCriteria, "acceptanceCriteria"),
    tasks: strList(i.tasks, "tasks"),
    devNotes: reqStr(i.devNotes, "devNotes"),
  };
}
