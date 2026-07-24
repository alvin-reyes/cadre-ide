import { describe, it, expect } from "vitest";
import { pickAssignable, ReadyStory } from "./pool";

describe("pickAssignable", () => {
  // Helper to build ReadyStory objects
  const s = (id: string, files: string[]): ReadyStory => ({ id, files });

  it("returns all stories when all are disjoint and freeSlots >= count", () => {
    const ready = [s("A", ["a.ts"]), s("B", ["b.ts"]), s("C", ["c.ts"])];
    const result = pickAssignable(ready, new Set(), 10);
    expect(result.map((r) => r.id)).toEqual(["A", "B", "C"]);
  });

  it("preserves input order", () => {
    const ready = [s("Z", ["z.ts"]), s("A", ["a.ts"]), s("M", ["m.ts"])];
    const result = pickAssignable(ready, new Set(), 10);
    expect(result.map((r) => r.id)).toEqual(["Z", "A", "M"]);
  });

  it("skips second story when two stories share a file", () => {
    const ready = [s("A", ["shared.ts"]), s("B", ["shared.ts"])];
    const result = pickAssignable(ready, new Set(), 10);
    expect(result.map((r) => r.id)).toEqual(["A"]);
  });

  it("allows later disjoint stories after a conflict", () => {
    const ready = [s("A", ["shared.ts"]), s("B", ["shared.ts"]), s("C", ["c.ts"])];
    const result = pickAssignable(ready, new Set(), 10);
    expect(result.map((r) => r.id)).toEqual(["A", "C"]);
  });

  it("skips a story that shares a file with inFlightFiles", () => {
    const ready = [s("A", ["inflight.ts"]), s("B", ["b.ts"])];
    const inFlight = new Set(["inflight.ts"]);
    const result = pickAssignable(ready, inFlight, 10);
    expect(result.map((r) => r.id)).toEqual(["B"]);
  });

  it("picks later disjoint stories even when an earlier one conflicts with inFlightFiles", () => {
    const ready = [s("A", ["inflight.ts"]), s("B", ["b.ts"]), s("C", ["c.ts"])];
    const inFlight = new Set(["inflight.ts"]);
    const result = pickAssignable(ready, inFlight, 10);
    expect(result.map((r) => r.id)).toEqual(["B", "C"]);
  });

  it("caps results at freeSlots", () => {
    const ready = [s("A", ["a.ts"]), s("B", ["b.ts"]), s("C", ["c.ts"]), s("D", ["d.ts"]), s("E", ["e.ts"])];
    const result = pickAssignable(ready, new Set(), 2);
    expect(result.map((r) => r.id)).toEqual(["A", "B"]);
  });

  it("returns empty array when ready is empty", () => {
    expect(pickAssignable([], new Set(), 5)).toEqual([]);
  });

  it("returns empty array when freeSlots is 0", () => {
    const ready = [s("A", ["a.ts"]), s("B", ["b.ts"])];
    expect(pickAssignable(ready, new Set(), 0)).toEqual([]);
  });

  describe("no-files stories (conservative isolation)", () => {
    it("returns a no-files story alone when inFlightFiles is empty and it is first", () => {
      const ready = [s("NFILES", []), s("B", ["b.ts"])];
      const result = pickAssignable(ready, new Set(), 10);
      expect(result.map((r) => r.id)).toEqual(["NFILES"]);
    });

    it("does NOT return a no-files story when inFlightFiles is non-empty", () => {
      const ready = [s("NFILES", [])];
      const inFlight = new Set(["something.ts"]);
      const result = pickAssignable(ready, inFlight, 10);
      expect(result).toEqual([]);
    });

    it("blocks further picks once a no-files story is picked (runs alone)", () => {
      const ready = [s("NFILES", []), s("B", ["b.ts"]), s("C", ["c.ts"])];
      const result = pickAssignable(ready, new Set(), 10);
      // No-files story picked first, nothing else should join
      expect(result.map((r) => r.id)).toEqual(["NFILES"]);
    });

    it("skips a no-files story if there are already picks made (used set non-empty)", () => {
      // A has files → gets picked first; then NFILES should be skipped because used is non-empty
      const ready = [s("A", ["a.ts"]), s("NFILES", []), s("B", ["b.ts"])];
      const result = pickAssignable(ready, new Set(), 10);
      expect(result.map((r) => r.id)).toEqual(["A", "B"]);
    });

    it("a no-files story preceded by a disjoint story is skipped (used non-empty)", () => {
      const ready = [s("A", ["a.ts"]), s("NFILES", [])];
      const result = pickAssignable(ready, new Set(), 10);
      expect(result.map((r) => r.id)).toEqual(["A"]);
    });
  });

  describe("input mutation", () => {
    it("does not mutate the ready array", () => {
      const ready = [s("A", ["a.ts"]), s("B", ["b.ts"])];
      const readyCopy = ready.map((r) => ({ ...r, files: [...r.files] }));
      pickAssignable(ready, new Set(), 10);
      expect(ready).toEqual(readyCopy);
    });

    it("does not mutate inFlightFiles", () => {
      const inFlight = new Set(["x.ts"]);
      const before = new Set(inFlight);
      pickAssignable([s("A", ["a.ts"])], inFlight, 10);
      expect(inFlight).toEqual(before);
    });
  });
});
