import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadView, saveView } from "./viewPreference";

// node test env has no DOM — provide a minimal in-memory localStorage.
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});

describe("viewPreference", () => {
  it("returns null when nothing is saved for a root", () => {
    expect(loadView("/a")).toBeNull();
  });

  it("round-trips a saved view per root", () => {
    saveView("/a", "terminal");
    saveView("/b", "files");
    expect(loadView("/a")).toBe("terminal");
    expect(loadView("/b")).toBe("files");
  });

  it("overwrites a prior view for the same root", () => {
    saveView("/a", "terminal");
    saveView("/a", "context");
    expect(loadView("/a")).toBe("context");
  });

  it("returns null on corrupt storage", () => {
    localStorage.setItem("cadre-project-views", "not json");
    expect(loadView("/a")).toBeNull();
  });
});
