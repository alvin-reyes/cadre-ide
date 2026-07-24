import { describe, it, expect } from "vitest";
import { CREATE_STORY_TOOL, storyContentFromTool } from "./storyTool";

const valid = {
  title: "Login endpoint",
  role: "user",
  action: "to log in with email and password",
  benefit: "I can access my account",
  acceptanceCriteria: ["returns 200 on valid creds", "returns 401 on bad creds"],
  tasks: ["write failing test", "implement handler"],
  devNotes: "Use the auth service in src/auth; follow the error format in standards.",
  definitionOfDone: ["All ACs pass with automated tests", "Returns 401 on bad creds", "No regressions", "Verification command green"],
};

describe("CREATE_STORY_TOOL", () => {
  it("declares the create_story tool with all required fields", () => {
    expect(CREATE_STORY_TOOL.name).toBe("create_story");
    expect(CREATE_STORY_TOOL.input_schema.required).toContain("devNotes");
    expect(CREATE_STORY_TOOL.input_schema.required).toContain("acceptanceCriteria");
    expect(CREATE_STORY_TOOL.input_schema.required).toContain("definitionOfDone");
  });

  it("has definitionOfDone as an array-of-strings property with an extensive description", () => {
    const prop = CREATE_STORY_TOOL.input_schema.properties.definitionOfDone;
    expect(prop.type).toBe("array");
    expect(prop.description).toMatch(/EXTENSIVE/i);
  });
});

describe("storyContentFromTool", () => {
  it("maps a valid tool call into StoryContent with epic/story", () => {
    const c = storyContentFromTool(valid, 1, 2);
    expect(c.epic).toBe(1);
    expect(c.story).toBe(2);
    expect(c.title).toBe("Login endpoint");
    expect(c.userStory).toEqual({
      role: "user",
      action: "to log in with email and password",
      benefit: "I can access my account",
    });
    expect(c.acceptanceCriteria).toHaveLength(2);
    expect(c.devNotes).toContain("auth service");
    expect(c.definitionOfDone).toHaveLength(4);
    expect(c.definitionOfDone[0]).toContain("ACs pass");
  });

  it("throws when a required string is missing or empty", () => {
    expect(() => storyContentFromTool({ ...valid, title: "" }, 1, 1)).toThrow(/title/);
    expect(() => storyContentFromTool({ ...valid, devNotes: undefined }, 1, 1)).toThrow(
      /devNotes/
    );
  });

  it("throws when a list field isn't a list", () => {
    expect(() =>
      storyContentFromTool({ ...valid, acceptanceCriteria: "nope" }, 1, 1)
    ).toThrow(/acceptanceCriteria/);
    expect(() =>
      storyContentFromTool({ ...valid, definitionOfDone: "not a list" }, 1, 1)
    ).toThrow(/definitionOfDone/);
  });

  it("drops non-string items from list fields", () => {
    const c = storyContentFromTool(
      { ...valid, tasks: ["ok", 42, null, "also ok"] },
      1,
      1
    );
    expect(c.tasks).toEqual(["ok", "also ok"]);
  });
});
