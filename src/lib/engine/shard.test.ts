import { describe, it, expect } from "vitest";
import {
  nextStoryNumber,
  slugify,
  storyFilename,
  composeStoryFile,
  shardStory,
  type ShardDeps,
  type StoryContent,
} from "./shard";

describe("nextStoryNumber", () => {
  it("starts at 1 when the epic has no stories", () => {
    expect(nextStoryNumber(1, [])).toBe(1);
    expect(nextStoryNumber(3, ["1.1", "1.2"])).toBe(1);
  });

  it("increments within the epic", () => {
    expect(nextStoryNumber(1, ["1.1", "1.2"])).toBe(3);
  });

  it("keeps epics independent", () => {
    const ids = ["1.1", "1.2", "2.1"];
    expect(nextStoryNumber(1, ids)).toBe(3);
    expect(nextStoryNumber(2, ids)).toBe(2);
    expect(nextStoryNumber(3, ids)).toBe(1);
  });
});

describe("slugify + storyFilename", () => {
  it("lowercases and turns spaces/underscores into hyphens", () => {
    expect(slugify("Add Login Flow")).toBe("add-login-flow");
    expect(slugify("Add_Login  Flow")).toBe("add-login-flow");
  });

  it("strips non-url characters", () => {
    expect(slugify("Fix: the (broken) thing!")).toBe("fix-the-broken-thing");
  });

  it("builds the correct docs/stories path", () => {
    expect(storyFilename(1, 2, "Add Login Flow")).toBe(
      "docs/stories/1.2.add-login-flow.md"
    );
  });
});

const sampleContent: StoryContent = {
  epic: 1,
  story: 2,
  title: "Add Login Flow",
  userStory: {
    role: "user",
    action: "to log in with email and password",
    benefit: "I can access my account",
  },
  acceptanceCriteria: [
    "Given valid credentials, the user is logged in",
    "Given invalid credentials, an error is shown",
  ],
  tasks: ["Build the login form", "Wire up the auth API"],
  devNotes: "Use the existing AuthService in src/lib/auth.",
  files: ["src/components/Login.tsx", "src/lib/auth.ts"],
};

describe("composeStoryFile", () => {
  const md = composeStoryFile(sampleContent);

  it("has the title heading", () => {
    expect(md).toContain("# Story 1.2: Add Login Flow");
  });

  it("has a Status section set to Draft", () => {
    expect(md).toContain("## Status");
    expect(md).toMatch(/## Status\n\nDraft/);
  });

  it("has the As a / I want / so that story lines", () => {
    expect(md).toContain("**As a** user,");
    expect(md).toContain("**I want** to log in with email and password,");
    expect(md).toContain("**so that** I can access my account");
  });

  it("numbers the acceptance criteria", () => {
    expect(md).toContain("1. Given valid credentials, the user is logged in");
    expect(md).toContain("2. Given invalid credentials, an error is shown");
  });

  it("renders tasks as checkbox bullets", () => {
    expect(md).toContain("- [ ] Build the login form");
    expect(md).toContain("- [ ] Wire up the auth API");
  });

  it("includes the dev notes", () => {
    expect(md).toContain("Use the existing AuthService in src/lib/auth.");
  });

  it("leaves the Dev Agent Record and QA Results sections empty", () => {
    expect(md).toContain("## Dev Agent Record");
    expect(md).toContain("## QA Results");
    // No content between the Dev Agent Record heading and QA Results heading.
    expect(md).toMatch(/## Dev Agent Record\n\n## QA Results/);
  });
});

describe("shardStory", () => {
  function recordingDeps() {
    const calls: { path: string; content: string }[] = [];
    const deps: ShardDeps = {
      writeFile: async (path, content) => {
        calls.push({ path, content });
      },
    };
    return { deps, calls };
  }

  it("writes the composed file to the slugified path and returns it", async () => {
    const { deps, calls } = recordingDeps();
    const result = await shardStory(deps, sampleContent);

    expect(result).toEqual({ path: "docs/stories/1.2.add-login-flow.md" });
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("docs/stories/1.2.add-login-flow.md");
    expect(calls[0].content).toBe(composeStoryFile(sampleContent));
    expect(calls[0].content).toContain("# Story 1.2: Add Login Flow");
  });
});
