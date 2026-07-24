import { describe, it, expect } from "vitest";
import { emptyBmadSlice, mirrorBmad, updateSlice, emptyCadreSlice, mirrorCadre } from "./projectSlices";
import { emptyBoard } from "./board";

describe("projectSlices", () => {
  it("emptyBmadSlice has an empty board and no stories", () => {
    const s = emptyBmadSlice();
    expect(s.stories).toEqual([]);
    expect(s.watchError).toBeNull();
    expect(s.board).toEqual(emptyBoard());
  });

  it("updateSlice creates and merges a slice immutably", () => {
    const a = updateSlice<{ n: number; k: string }>({}, "/p", { n: 1 }, () => ({ n: 0, k: "" }));
    expect(a["/p"]).toEqual({ n: 1, k: "" });
    const b = updateSlice(a, "/p", { k: "x" }, () => ({ n: 0, k: "" }));
    expect(b["/p"]).toEqual({ n: 1, k: "x" });
    expect(b).not.toBe(a);
  });

  it("mirrorBmad reflects the active slice, or empty when none", () => {
    const slice = { ...emptyBmadSlice(), stories: [{ id: "1.1" } as never] };
    const m = mirrorBmad({ "/p": slice }, "/p");
    expect(m.projectRoot).toBe("/p");
    expect(m.stories).toBe(slice.stories);
    const none = mirrorBmad({ "/p": slice }, null);
    expect(none.projectRoot).toBeNull();
    expect(none.stories).toEqual([]);
  });

  // --- CadreSlice / mirrorCadre tests ---

  describe("emptyCadreSlice", () => {
    it("initialises busy and error to null", () => {
      const s = emptyCadreSlice();
      expect(s.busy).toBeNull();
      expect(s.error).toBeNull();
    });

    it("initialises all string fields to empty string and boolean fields to false", () => {
      const s = emptyCadreSlice();
      expect(s.prd).toBe("");
      expect(s.architecture).toBe("");
      expect(s.phase).toBe("PLAN");
      expect(s.isBrownfield).toBe(false);
      expect(s.needsReplan).toBe(false);
      expect(s.verification).toEqual([]);
    });
  });

  describe("mirrorCadre", () => {
    it("returns empty-slice defaults when activeRoot is null", () => {
      const m = mirrorCadre({}, null);
      expect(m.busy).toBeNull();
      expect(m.error).toBeNull();
      expect(m.prd).toBe("");
      expect(m.phase).toBe("PLAN");
    });

    it("returns empty-slice defaults when activeRoot is absent from projects map", () => {
      const m = mirrorCadre({}, "/nonexistent");
      expect(m.busy).toBeNull();
      expect(m.error).toBeNull();
    });

    it("copies busy and error from the active slice", () => {
      const slice = { ...emptyCadreSlice(), busy: "Dispatching…", error: "something went wrong" };
      const m = mirrorCadre({ "/a": slice }, "/a");
      expect(m.busy).toBe("Dispatching…");
      expect(m.error).toBe("something went wrong");
    });

    it("returns null busy/error when the active slice has null values", () => {
      const slice = { ...emptyCadreSlice(), busy: null, error: null };
      const m = mirrorCadre({ "/a": slice }, "/a");
      expect(m.busy).toBeNull();
      expect(m.error).toBeNull();
    });

    it("mirrors only the active slice — not other projects' slices", () => {
      const sliceA = { ...emptyCadreSlice(), prd: "A's PRD", busy: "busy-A" };
      const sliceB = { ...emptyCadreSlice(), prd: "B's PRD", busy: "busy-B" };
      const ma = mirrorCadre({ "/a": sliceA, "/b": sliceB }, "/a");
      expect(ma.prd).toBe("A's PRD");
      expect(ma.busy).toBe("busy-A");
      const mb = mirrorCadre({ "/a": sliceA, "/b": sliceB }, "/b");
      expect(mb.prd).toBe("B's PRD");
      expect(mb.busy).toBe("busy-B");
    });
  });
});
