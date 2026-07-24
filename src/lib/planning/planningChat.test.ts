import { describe, it, expect } from "vitest";
import { HANDOFF_TOOL } from "./planningChat";

/**
 * planningChat.test.ts — tests for the HANDOFF_TOOL enum and handoff role parsing.
 *
 * The planningTurn function itself requires a live Anthropic SDK so we test the
 * structural invariants (HANDOFF_TOOL enum) that drive the accepted-handoff branch.
 */

describe("HANDOFF_TOOL", () => {
  const roles = HANDOFF_TOOL.input_schema.properties.role.enum as string[];

  it("includes analyst, architect, design, and techwriter", () => {
    expect(roles).toContain("analyst");
    expect(roles).toContain("architect");
    expect(roles).toContain("design");
    expect(roles).toContain("techwriter");
  });

  it("includes devops as a valid handoff role", () => {
    expect(roles).toContain("devops");
  });

  it("has exactly five roles (no regressions or extras)", () => {
    expect(roles).toHaveLength(5);
  });
});
