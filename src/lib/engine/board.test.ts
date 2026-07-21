import { describe, it, expect } from "vitest";
import {
  emptyBoard,
  applyStatus,
  boardStories,
  parseStoryFilename,
  parseStateFilename,
  reconcile,
} from "./board";

describe("filename parsing", () => {
  it("parses a story filename", () => {
    expect(parseStoryFilename("1.2.login-ui.story.md")).toEqual({
      epic: 1,
      story: 2,
      slug: "login-ui.story",
    });
    expect(parseStoryFilename("notes.md")).toBeNull();
  });

  it("parses a state filename", () => {
    expect(parseStateFilename("3.4.json")).toEqual({ epic: 3, story: 4 });
    expect(parseStateFilename("plan.json")).toBeNull();
  });
});

describe("board", () => {
  it("applies status, creating a card if new", () => {
    const b = applyStatus(emptyBoard(), 1, 1, "InProgress");
    expect(b.stories["1.1"].status).toBe("InProgress");
  });

  it("orders stories by epic then story", () => {
    let b = emptyBoard();
    b = applyStatus(b, 2, 1, "Draft");
    b = applyStatus(b, 1, 3, "Draft");
    b = applyStatus(b, 1, 1, "Draft");
    expect(boardStories(b).map((s) => s.id)).toEqual(["1.1", "1.3", "2.1"]);
  });
});

describe("reconcile", () => {
  it("updates status from an engine state-file change", () => {
    const b = reconcile(emptyBoard(), {
      kind: "state",
      filename: "1.2.json",
      content: JSON.stringify({ epic: 1, story: 2, status: "Done" }),
    });
    expect(b.stories["1.2"].status).toBe("Done");
  });

  it("ignores a torn/partial state write", () => {
    const before = applyStatus(emptyBoard(), 1, 2, "InReview");
    const after = reconcile(before, {
      kind: "state",
      filename: "1.2.json",
      content: "{ not valid json",
    });
    expect(after.stories["1.2"].status).toBe("InReview");
  });

  it("creates a Draft card with a humanized title when a story file appears", () => {
    const b = reconcile(emptyBoard(), {
      kind: "story",
      filename: "2.1.session-store.story.md",
    });
    expect(b.stories["2.1"].status).toBe("Draft");
    expect(b.stories["2.1"].title).toBe("session store");
  });

  it("does not overwrite an existing story's status when its file changes", () => {
    const before = applyStatus(emptyBoard(), 2, 1, "Done");
    const after = reconcile(before, {
      kind: "story",
      filename: "2.1.session-store.story.md",
    });
    expect(after.stories["2.1"].status).toBe("Done"); // preserved
    expect(after.stories["2.1"].title).toBe("session store");
  });

  it("ignores unrelated filenames", () => {
    const b = reconcile(emptyBoard(), { kind: "story", filename: "README.md" });
    expect(boardStories(b)).toEqual([]);
  });
});
