import { describe, it, expect } from "vitest";
import { addRoot, removeRoot } from "./openProjectsStore";

describe("open-projects list ops", () => {
  it("addRoot appends unique and keeps order", () => {
    expect(addRoot(["/a"], "/b")).toEqual(["/a", "/b"]);
    expect(addRoot(["/a", "/b"], "/a")).toEqual(["/a", "/b"]);
  });
  it("removeRoot drops and picks a neighbor as next active", () => {
    const { roots, next } = removeRoot(["/a", "/b", "/c"], "/b", "/b");
    expect(roots).toEqual(["/a", "/c"]);
    expect(next).toBe("/c");
  });
  it("removeRoot keeps active when a different tab is closed", () => {
    const { next } = removeRoot(["/a", "/b"], "/a", "/b");
    expect(next).toBe("/b");
  });
});
