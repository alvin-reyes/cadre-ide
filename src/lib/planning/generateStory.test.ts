import { describe, it, expect } from "vitest";
import { generateStory, type GenerateStoryDeps } from "./generateStory";

const toolResult = {
  title: "Session store",
  role: "user",
  action: "my session to persist",
  benefit: "I stay logged in",
  acceptanceCriteria: ["session survives reload"],
  tasks: ["write failing test", "implement store"],
  devNotes: "Use redis per architecture/tech-stack.",
};

function makeDeps() {
  const calls: {
    system: string;
    user: string;
    toolName: string;
  }[] = [];
  const writes: { path: string; content: string }[] = [];
  const deps: GenerateStoryDeps = {
    callWithTool: async (systemPrompt, userPrompt, tool) => {
      calls.push({ system: systemPrompt, user: userPrompt, toolName: tool.name });
      return toolResult;
    },
    writeFile: async (path, content) => {
      writes.push({ path, content });
    },
  };
  return { deps, calls, writes };
}

const input = {
  systemPrompt: "You are Bob, the Scrum Master.",
  planContext: "Epic 2: sessions. Architecture: redis.",
  epic: 2,
  story: 1,
};

describe("generateStory", () => {
  it("runs the SM with create_story then shards the result to a file", async () => {
    const { deps, calls, writes } = makeDeps();
    const r = await generateStory(deps, input);

    expect(calls[0].toolName).toBe("create_story");
    expect(calls[0].system).toContain("Scrum Master");
    expect(calls[0].user).toContain("Epic 2: sessions"); // plan context passed through

    expect(r.path).toBe("docs/stories/2.1.session-store.md");
    expect(r.content.epic).toBe(2);
    expect(r.content.title).toBe("Session store");

    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe("docs/stories/2.1.session-store.md");
    expect(writes[0].content).toContain("# Story 2.1: Session store");
    expect(writes[0].content).toContain("session survives reload");
  });

  it("propagates validation errors from a malformed tool call", async () => {
    const { deps } = makeDeps();
    const badDeps = {
      ...deps,
      callWithTool: async () => ({ title: "" }), // missing required fields
    };
    await expect(generateStory(badDeps, input)).rejects.toThrow(/create_story/);
  });
});
