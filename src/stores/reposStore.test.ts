import { describe, it, expect } from "vitest";
import { upsertRepo, removeRepoFromList } from "./reposStore";

describe("upsertRepo", () => {
  it("adds a repo to an empty list", () => {
    const a = upsertRepo([], { id: "web", name: "Web", path: "../w" });
    expect(a).toHaveLength(1);
    expect(a[0]).toEqual({ id: "web", name: "Web", path: "../w" });
  });

  it("replaces a repo with the same id (keeps position)", () => {
    const a = upsertRepo([], { id: "web", name: "Web", path: "../w" });
    const b = upsertRepo(a, { id: "web", name: "Web2", path: "../w" });
    expect(b).toEqual([{ id: "web", name: "Web2", path: "../w" }]);
  });

  it("appends when id is new", () => {
    const list = [{ id: "web", name: "Web", path: "../w" }];
    const result = upsertRepo(list, { id: "api", name: "API", path: "../api" });
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({ id: "api", name: "API", path: "../api" });
  });

  it("preserves order when replacing in the middle", () => {
    const list = [
      { id: "a", name: "A", path: "./a" },
      { id: "b", name: "B", path: "./b" },
      { id: "c", name: "C", path: "./c" },
    ];
    const result = upsertRepo(list, { id: "b", name: "B2", path: "./b2" });
    expect(result.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(result[1].name).toBe("B2");
  });

  it("is immutable — does not mutate the input list", () => {
    const original = [{ id: "web", name: "Web", path: "../w" }];
    const copy = [...original];
    upsertRepo(original, { id: "api", name: "API", path: "../api" });
    expect(original).toEqual(copy);
  });

  it("preserves the verify field when upserting", () => {
    const list = [{ id: "web", name: "Web", path: "../w", verify: "npm test" }];
    const result = upsertRepo(list, { id: "web", name: "Web", path: "../w", verify: "make test" });
    expect(result[0].verify).toBe("make test");
  });
});

describe("removeRepoFromList", () => {
  it("drops by id", () => {
    expect(removeRepoFromList([{ id: "web", name: "W", path: "." }], "web")).toEqual([]);
  });

  it("removes the correct entry when multiple repos exist", () => {
    const list = [
      { id: "a", name: "A", path: "./a" },
      { id: "b", name: "B", path: "./b" },
      { id: "c", name: "C", path: "./c" },
    ];
    const result = removeRepoFromList(list, "b");
    expect(result.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("returns the same list if id not found", () => {
    const list = [{ id: "web", name: "W", path: "." }];
    const result = removeRepoFromList(list, "nonexistent");
    expect(result).toEqual(list);
  });

  it("is immutable — does not mutate the input list", () => {
    const original = [
      { id: "a", name: "A", path: "./a" },
      { id: "b", name: "B", path: "./b" },
    ];
    const copy = [...original];
    removeRepoFromList(original, "a");
    expect(original).toEqual(copy);
  });
});
