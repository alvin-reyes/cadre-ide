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
      files: {
        type: "array",
        items: { type: "string" },
        description:
          "The repo-relative files this story is expected to create or modify. Keep stories file-DISJOINT from each other so they can build in parallel without conflicts. List the specific paths you know; be accurate — Cadre uses this to schedule parallel agents.",
      },
    },
    required: ["title", "role", "action", "benefit", "acceptanceCriteria", "tasks", "devNotes", "files"],
  },
} as const;

/**
 * The full-lifecycle backlog tool: emit MANY stories at once covering the whole
 * software-engineering cycle, not just features. Each item is a create_story
 * payload plus a `phase` tag.
 */
export const CREATE_BACKLOG_TOOL = {
  name: "create_backlog",
  description:
    "Emit the COMPLETE backlog of stories to ship this plan through the full software-engineering lifecycle: project setup/scaffolding, each feature, automated tests, integration, CI/CD, deployment, observability/monitoring, documentation, and ongoing support/operations. Not just features — cover every phase. Each story must be fully specified (a Dev agent works only from it) and file-disjoint where possible for parallel builds.",
  input_schema: {
    type: "object",
    properties: {
      stories: {
        type: "array",
        description: "Every story needed to deliver and operate this plan, in build order.",
        items: {
          type: "object",
          properties: {
            phase: {
              type: "string",
              enum: ["setup", "feature", "test", "integration", "deploy", "monitoring", "docs", "support"],
              description: "Which lifecycle phase this story belongs to.",
            },
            ...CREATE_STORY_TOOL.input_schema.properties,
          },
          required: ["phase", ...CREATE_STORY_TOOL.input_schema.required],
        },
      },
    },
    required: ["stories"],
  },
} as const;

/** Validate + map a create_backlog tool call into ordered StoryContents. */
export function backlogFromTool(input: unknown, epic: number, startNumber: number): StoryContent[] {
  const i = (input ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(i.stories) ? i.stories : [];
  return raw.map((item, idx) => {
    const it = (item ?? {}) as Record<string, unknown>;
    const content = storyContentFromTool(it, epic, startNumber + idx);
    const phase = typeof it.phase === "string" ? it.phase : "";
    // Tag the title with its lifecycle phase so the board reads as a real backlog.
    return phase ? { ...content, title: `[${phase}] ${content.title}` } : content;
  });
}

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
    files: Array.isArray(i.files) ? i.files.filter((x): x is string => typeof x === "string") : [],
  };
}
