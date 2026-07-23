import { describe, it, expect } from "vitest";
import { emptyBmadSlice, mirrorBmad, updateSlice } from "./projectSlices";
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
});
