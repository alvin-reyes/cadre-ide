import { describe, it, expect } from "vitest";
import { canDispatch, type PlanApproval } from "./planApproval";

const approved: PlanApproval = { approved: true, verification: ["pnpm test"] };

describe("canDispatch (PLAN gate)", () => {
  it("allows dispatch only when plan + architecture + approval are all present", () => {
    expect(
      canDispatch({ prdExists: true, architectureExists: true, approval: approved })
    ).toBe(true);
  });

  it("blocks dispatch when the PRD is missing", () => {
    expect(
      canDispatch({ prdExists: false, architectureExists: true, approval: approved })
    ).toBe(false);
  });

  it("blocks dispatch when architecture is missing", () => {
    expect(
      canDispatch({ prdExists: true, architectureExists: false, approval: approved })
    ).toBe(false);
  });

  it("blocks dispatch when the plan is not approved", () => {
    expect(
      canDispatch({ prdExists: true, architectureExists: true, approval: null })
    ).toBe(false);
    expect(
      canDispatch({
        prdExists: true,
        architectureExists: true,
        approval: { approved: false, verification: ["pnpm test"] },
      })
    ).toBe(false);
  });

  it("blocks dispatch when no verification command was frozen", () => {
    expect(
      canDispatch({
        prdExists: true,
        architectureExists: true,
        approval: { approved: true, verification: [] },
      })
    ).toBe(false);
  });
});
