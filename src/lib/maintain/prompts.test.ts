import { describe, it, expect } from "vitest";
import { searchPrompts, groupByCategory, type Prompt } from "./prompts";
import { BUILTIN_PROMPTS } from "./promptCatalog";

const P = (id: string, title: string, body: string, category: Prompt["category"]): Prompt =>
  ({ id, title, body, category, builtin: true });

describe("searchPrompts", () => {
  const list = [P("a", "Add a failing test", "write a test", "Testing"), P("b", "Bump deps", "upgrade", "Dependencies")];
  it("matches title case-insensitively", () => {
    expect(searchPrompts(list, "FAILING").map((p) => p.id)).toEqual(["a"]);
  });
  it("matches body", () => {
    expect(searchPrompts(list, "upgrade").map((p) => p.id)).toEqual(["b"]);
  });
  it("returns all on empty query", () => {
    expect(searchPrompts(list, "  ").length).toBe(2);
  });
});

describe("groupByCategory", () => {
  const list = [P("a", "t", "b", "Testing"), P("b", "r", "b", "Refactor"), P("c", "t2", "b", "Testing")];
  it("groups by category preserving order, categories with items only", () => {
    const groups = groupByCategory(list, []);
    expect(groups.map((g) => g.category)).toEqual(["Testing", "Refactor"]);
    expect(groups[0].prompts.map((p) => p.id)).toEqual(["a", "c"]);
  });
  it("floats favorites into a leading Favorites group (originals stay in place)", () => {
    const groups = groupByCategory(list, ["b"]);
    expect(groups[0].category).toBe("Favorites");
    expect(groups[0].prompts.map((p) => p.id)).toEqual(["b"]);
    expect(groups.find((g) => g.category === "Refactor")!.prompts.map((p) => p.id)).toEqual(["b"]);
  });
});

describe("BUILTIN_PROMPTS", () => {
  it("has >= 5 prompts in every category with unique ids", () => {
    const cats = ["Testing", "Refactor", "Debug", "Review", "Git", "Docs", "Dependencies", "Performance", "Security"] as const;
    for (const c of cats) expect(BUILTIN_PROMPTS.filter((p) => p.category === c).length).toBeGreaterThanOrEqual(5);
    expect(new Set(BUILTIN_PROMPTS.map((p) => p.id)).size).toBe(BUILTIN_PROMPTS.length);
  });
});
