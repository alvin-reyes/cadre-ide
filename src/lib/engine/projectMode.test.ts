import { describe, it, expect } from "vitest";
import { detectProjectMode } from "./projectMode";

describe("detectProjectMode", () => {
  it("is 'build' when a PRD exists (greenfield in progress)", () => {
    expect(detectProjectMode({ hasPrd: true, hasStories: false })).toBe("build");
  });
  it("is 'build' when stories have been sharded", () => {
    expect(detectProjectMode({ hasPrd: false, hasStories: true })).toBe("build");
  });
  it("is 'maintain' for an existing app with no greenfield artifacts", () => {
    expect(detectProjectMode({ hasPrd: false, hasStories: false })).toBe("maintain");
  });
});
