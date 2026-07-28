import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildSnapshot, useWorkspaceSnapshots } from "./workspaceSnapshots";

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
  useWorkspaceSnapshots.setState({ snapshots: [] });
});

describe("buildSnapshot", () => {
  it("captures each open project's name, mode, and view", () => {
    const snap = buildSnapshot({
      id: "w1",
      name: "  Morning  ",
      savedAt: 1000,
      activeRoot: "/b",
      roots: ["/a", "/b"],
      nameOf: (r) => (r === "/a" ? "alpha" : "beta"),
      modeOf: (r) => (r === "/a" ? "maintain" : "build"),
      viewOf: (r) => (r === "/a" ? "terminal" : "orchestrator"),
    });
    expect(snap.name).toBe("Morning"); // trimmed
    expect(snap.activeRoot).toBe("/b");
    expect(snap.projects).toEqual([
      { root: "/a", name: "alpha", mode: "maintain", view: "terminal" },
      { root: "/b", name: "beta", mode: "build", view: "orchestrator" },
    ]);
  });

  it("falls back to a default name when blank", () => {
    const snap = buildSnapshot({ id: "w", name: "   ", savedAt: 1, activeRoot: null, roots: [], nameOf: () => "", modeOf: () => "build", viewOf: () => "orchestrator" });
    expect(snap.name).toBe("Untitled workspace");
  });
});

describe("useWorkspaceSnapshots store", () => {
  const mk = (id: string, name: string) => ({ id, name, savedAt: 1, activeRoot: null, projects: [] });

  it("saves newest-first and persists", () => {
    useWorkspaceSnapshots.getState().save(mk("a", "A"));
    useWorkspaceSnapshots.getState().save(mk("b", "B"));
    expect(useWorkspaceSnapshots.getState().snapshots.map((s) => s.id)).toEqual(["b", "a"]);
    expect(localStorage.getItem("cadre-workspace-snapshots")).toContain('"b"');
  });

  it("replaces a snapshot saved under an existing id", () => {
    useWorkspaceSnapshots.getState().save(mk("a", "A"));
    useWorkspaceSnapshots.getState().save(mk("a", "A2"));
    const list = useWorkspaceSnapshots.getState().snapshots;
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("A2");
  });

  it("removes by id", () => {
    useWorkspaceSnapshots.getState().save(mk("a", "A"));
    useWorkspaceSnapshots.getState().save(mk("b", "B"));
    useWorkspaceSnapshots.getState().remove("a");
    expect(useWorkspaceSnapshots.getState().snapshots.map((s) => s.id)).toEqual(["b"]);
  });
});
