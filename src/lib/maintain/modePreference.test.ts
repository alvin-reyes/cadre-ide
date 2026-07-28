import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadModeChoice, saveModeChoice } from "./modePreference";

// The suite runs in the `node` environment (no DOM), so provide a minimal
// in-memory localStorage before each test.
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});

describe("modePreference", () => {
  it("returns null for a project with no remembered choice", () => {
    expect(loadModeChoice("/a")).toBeNull();
  });

  it("round-trips a saved choice per root", () => {
    saveModeChoice("/a", "maintain");
    saveModeChoice("/b", "build");
    expect(loadModeChoice("/a")).toBe("maintain");
    expect(loadModeChoice("/b")).toBe("build");
  });

  it("overwrites a prior choice for the same root", () => {
    saveModeChoice("/a", "maintain");
    saveModeChoice("/a", "build");
    expect(loadModeChoice("/a")).toBe("build");
  });

  it("ignores a corrupt/invalid stored value", () => {
    localStorage.setItem("cadre-project-modes", "not json");
    expect(loadModeChoice("/a")).toBeNull();
    localStorage.setItem("cadre-project-modes", JSON.stringify({ "/a": "nonsense" }));
    expect(loadModeChoice("/a")).toBeNull();
  });
});
