import { describe, it, expect } from "vitest";
import { scheduleParallel, normalizeFile } from "./schedule";

describe("normalizeFile", () => {
  it("strips ./ and leading slashes and trims", () => {
    expect(normalizeFile(" ./src/a.ts ")).toBe("src/a.ts");
    expect(normalizeFile("/src/a.ts")).toBe("src/a.ts");
    expect(normalizeFile("src/a.ts")).toBe("src/a.ts");
  });
});

describe("scheduleParallel", () => {
  it("runs file-disjoint stories together in one batch", () => {
    const batches = scheduleParallel([
      { id: "1.1", files: ["src/a.ts"] },
      { id: "1.2", files: ["src/b.ts"] },
      { id: "1.3", files: ["src/c.ts"] },
    ]);
    expect(batches).toEqual([["1.1", "1.2", "1.3"]]);
  });

  it("serializes stories that share a file into later batches", () => {
    const batches = scheduleParallel([
      { id: "1.1", files: ["src/a.ts", "src/shared.ts"] },
      { id: "1.2", files: ["src/shared.ts"] }, // collides with 1.1
      { id: "1.3", files: ["src/b.ts"] }, // disjoint from 1.1
    ]);
    // 1.1 and 1.3 are disjoint (batch 1); 1.2 collides with 1.1 → batch 2.
    expect(batches).toEqual([["1.1", "1.3"], ["1.2"]]);
  });

  it("treats a story with no declared files as run-alone (sealed batch)", () => {
    const batches = scheduleParallel([
      { id: "1.1", files: [] },
      { id: "1.2", files: ["src/b.ts"] },
    ]);
    expect(batches).toEqual([["1.1"], ["1.2"]]);
  });

  it("respects the concurrency cap", () => {
    const batches = scheduleParallel(
      [
        { id: "1.1", files: ["a"] },
        { id: "1.2", files: ["b"] },
        { id: "1.3", files: ["c"] },
      ],
      2
    );
    expect(batches).toEqual([["1.1", "1.2"], ["1.3"]]);
  });

  it("normalizes paths so ./a and a collide", () => {
    const batches = scheduleParallel([
      { id: "1.1", files: ["src/a.ts"] },
      { id: "1.2", files: ["./src/a.ts"] },
    ]);
    expect(batches).toEqual([["1.1"], ["1.2"]]);
  });
});
