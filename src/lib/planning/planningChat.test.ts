import { describe, it, expect } from "vitest";
import { HANDOFF_TOOL } from "./planningChat";

describe("HANDOFF_TOOL", () => {
  const roles = HANDOFF_TOOL.input_schema.properties.role.enum as string[];

  it("includes architect and design", () => {
    expect(roles).toContain("architect");
    expect(roles).toContain("design");
  });

  it("does not include removed roles", () => {
    expect(roles).not.toContain("analyst");
    expect(roles).not.toContain("techwriter");
    expect(roles).not.toContain("devops");
  });

  it("has exactly two roles", () => {
    expect(roles).toHaveLength(2);
  });
});
