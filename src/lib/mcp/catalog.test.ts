import { describe, it, expect } from "vitest";
import { CATALOG, presetToConnection } from "./catalog";

describe("catalog", () => {
  it("every non-custom preset can deliver a token-auth connection", () => {
    for (const p of CATALOG.filter((x) => !x.custom)) {
      expect(p.secretFields.length).toBeGreaterThan(0);         // has a token to paste
      expect(p.secretFields.some((f) => f.required)).toBe(true);
      // No OAuth-only tiles: token/env/header auth only.
      expect(p.secretFields.every((f) => f.target === "env" || f.target === "header")).toBe(true);
    }
  });

  it("includes ClickUp and a custom escape hatch", () => {
    expect(CATALOG.find((p) => p.id === "clickup")).toBeTruthy();
    expect(CATALOG.find((p) => p.custom)).toBeTruthy();
  });

  it("seeds a Connection with secretRefs and a unique id", () => {
    const clickup = CATALOG.find((p) => p.id === "clickup")!;
    const c1 = presetToConnection(clickup, []);
    const c2 = presetToConnection(clickup, [c1]);
    expect(c1.id).toBe("clickup");
    expect(c2.id).toBe("clickup-2");
    expect(c1.secretRefs.map((r) => r.field)).toContain("CLICKUP_API_TOKEN");
    expect(c1.enabled).toBe(false);
    expect(c1.status).toBe("unconfigured");
  });
});
