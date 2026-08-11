import { describe, it, expect } from "vitest";

import { planApproval, canApprove, planningModel, PLANNING_MODEL } from "./planning";
import { canDispatch } from "../lib/engine/planApproval";

describe("planning helpers", () => {
  describe("planApproval", () => {
    it("produces the frozen { approved:true, verification } shape cadre run gates on", () => {
      const a = planApproval(["npm test"]);
      expect(a).toEqual({ approved: true, verification: ["npm test"] });
      // The engine's PLAN gate must accept it once the docs exist.
      expect(canDispatch({ prdExists: true, architectureExists: true, approval: a })).toBe(true);
    });

    it("carries multiple verification commands through untouched", () => {
      expect(planApproval(["npm run lint", "npm test"]).verification).toEqual([
        "npm run lint",
        "npm test",
      ]);
    });
  });

  describe("canApprove", () => {
    it("allows Draft → Approved (the fresh-shard case) and a null (no state) story", () => {
      expect(canApprove("Draft")).toBe(true);
      expect(canApprove(null)).toBe(true); // treated as Draft
    });

    it("is idempotent for an already-Approved story", () => {
      expect(canApprove("Approved")).toBe(true);
    });

    it("refuses illegal jumps into Approved", () => {
      expect(canApprove("InProgress")).toBe(false);
      expect(canApprove("InReview")).toBe(false);
      expect(canApprove("Failed")).toBe(false);
    });

    it("allows re-approving a Done story (re-open for scope change)", () => {
      expect(canApprove("Done")).toBe(true);
    });
  });

  describe("planningModel", () => {
    it("defaults to the planning-brain model when CADRE_PLANNING_MODEL is unset", () => {
      const saved = process.env.CADRE_PLANNING_MODEL;
      delete process.env.CADRE_PLANNING_MODEL;
      try {
        expect(planningModel()).toBe(PLANNING_MODEL);
      } finally {
        if (saved !== undefined) process.env.CADRE_PLANNING_MODEL = saved;
      }
    });

    it("honours a CADRE_PLANNING_MODEL override", () => {
      const saved = process.env.CADRE_PLANNING_MODEL;
      process.env.CADRE_PLANNING_MODEL = "claude-sonnet-4-6";
      try {
        expect(planningModel()).toBe("claude-sonnet-4-6");
      } finally {
        if (saved === undefined) delete process.env.CADRE_PLANNING_MODEL;
        else process.env.CADRE_PLANNING_MODEL = saved;
      }
    });
  });
});
