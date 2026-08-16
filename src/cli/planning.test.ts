import { describe, it, expect } from "vitest";

import { planApproval, canApprove, planningModel, PLANNING_MODEL, getPlanningKey } from "./planning";
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

  describe("getPlanningKey (bounded keychain read)", () => {
    // The reader/timeout are injected so we never touch the real keychain or wait 60s.
    const withoutEnvKey = async (fn: () => Promise<void>) => {
      const saved = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      try {
        await fn();
      } finally {
        if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
        else process.env.ANTHROPIC_API_KEY = saved;
      }
    };

    it("prefers ANTHROPIC_API_KEY and never touches the keychain", async () => {
      const saved = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = "  sk-ant-env  ";
      let read = false;
      try {
        const key = await getPlanningKey({ read: async () => { read = true; return "sk-keychain"; } });
        expect(key).toBe("sk-ant-env"); // trimmed
        expect(read).toBe(false);
      } finally {
        if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
        else process.env.ANTHROPIC_API_KEY = saved;
      }
    });

    it("returns the keychain value when the reader resolves", async () => {
      await withoutEnvKey(async () => {
        expect(await getPlanningKey({ read: async () => "sk-from-keychain" })).toBe("sk-from-keychain");
      });
    });

    it("returns null when the reader yields nothing", async () => {
      await withoutEnvKey(async () => {
        expect(await getPlanningKey({ read: async () => null })).toBeNull();
      });
    });

    it("times out to null (not a hang) and hints when the read never returns", async () => {
      await withoutEnvKey(async () => {
        const hints: string[] = [];
        const t = Date.now();
        const key = await getPlanningKey({
          timeoutMs: 60,
          read: () => new Promise<string | null>(() => {}), // never resolves (pending dialog)
          onHint: (m) => hints.push(m),
        });
        expect(key).toBeNull();
        expect(Date.now() - t).toBeLessThan(1000); // bounded, not a hang
        expect(hints.some((h) => /keychain approval/i.test(h))).toBe(true);
      });
    });
  });
});
