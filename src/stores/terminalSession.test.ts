import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadStructure, saveStructure, loadBuffer, saveBuffer, clearBuffer, tabLabel, normalizeTitle } from "./terminalSession";

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});

describe("terminalSession structure", () => {
  it("returns null when nothing is saved", () => {
    expect(loadStructure("maintain:/a")).toBeNull();
  });

  it("round-trips a tab/pane structure per surface", () => {
    const tabs = [{ id: "t1", panes: [{ key: "p1", cwd: "/a", startupCommand: "claude" }] }];
    saveStructure("maintain:/a", tabs);
    expect(loadStructure("maintain:/a")).toEqual(tabs);
    expect(loadStructure("dock:/a")).toBeNull(); // different surface
  });

  it("treats an empty tab list as nothing saved", () => {
    saveStructure("maintain:/a", []);
    expect(loadStructure("maintain:/a")).toBeNull();
  });
});

describe("terminalSession buffers", () => {
  it("round-trips and clears a pane buffer", () => {
    saveBuffer("s::p1", "hello");
    expect(loadBuffer("s::p1")).toBe("hello");
    clearBuffer("s::p1");
    expect(loadBuffer("s::p1")).toBeNull();
  });

  it("truncates an oversized buffer to its tail", () => {
    const big = "x".repeat(60_000) + "TAIL";
    saveBuffer("s::p1", big);
    const got = loadBuffer("s::p1")!;
    expect(got.length).toBeLessThanOrEqual(48_000);
    expect(got.endsWith("TAIL")).toBe(true);
  });
});

describe("tabLabel", () => {
  it("falls back to the positional default when a tab has no title", () => {
    expect(tabLabel({ id: "t1", panes: [] }, 0)).toBe("Terminal 1");
    expect(tabLabel({ id: "t2", panes: [] }, 3)).toBe("Terminal 4");
  });

  it("prefers a custom title over the positional default", () => {
    expect(tabLabel({ id: "t1", panes: [], title: "build" }, 0)).toBe("build");
  });

  it("keeps a custom title stable regardless of position", () => {
    const tab = { id: "t1", panes: [], title: "logs" };
    expect(tabLabel(tab, 0)).toBe(tabLabel(tab, 5));
  });

  it("falls back when a persisted title is blank, so a tab can never render nameless", () => {
    // Defensive: normalizeTitle prevents this being stored, but older or
    // hand-edited localStorage could still carry one.
    expect(tabLabel({ id: "t1", panes: [], title: "   " }, 0)).toBe("Terminal 1");
  });
});

describe("normalizeTitle", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeTitle("  build  ")).toBe("build");
  });

  it("returns undefined for an empty or whitespace-only name, reverting to the default", () => {
    expect(normalizeTitle("")).toBeUndefined();
    expect(normalizeTitle("   ")).toBeUndefined();
  });

  it("caps a very long name at 60 chars so one tab cannot bloat the tab strip or storage", () => {
    const long = "x".repeat(200);
    expect(normalizeTitle(long)).toHaveLength(60);
  });

  it("leaves an ordinary name untouched", () => {
    expect(normalizeTitle("server logs")).toBe("server logs");
  });
});
