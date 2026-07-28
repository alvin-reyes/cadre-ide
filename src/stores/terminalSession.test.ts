import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadStructure, saveStructure, loadBuffer, saveBuffer, clearBuffer } from "./terminalSession";

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
