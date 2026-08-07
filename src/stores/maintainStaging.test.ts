import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadStaged, saveStaged } from "./maintainStaging";

// vitest runs with environment: "node" (see vitest.config.ts) — no global
// localStorage exists there, so stub one (same pattern as terminalSession.test.ts).
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});

describe("maintainStaging", () => {
  it("round-trips staged tasks per root", () => {
    saveStaged("/a", [{ id: "1", prompt: "x", createdAt: 1 }]);
    saveStaged("/b", [{ id: "2", prompt: "y", createdAt: 2 }]);
    expect(loadStaged("/a").map((t) => t.id)).toEqual(["1"]);
    expect(loadStaged("/b").map((t) => t.id)).toEqual(["2"]);
  });
  it("returns [] for an unknown root", () => {
    expect(loadStaged("/nope")).toEqual([]);
  });
});
