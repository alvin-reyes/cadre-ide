import { describe, it, expect, beforeEach } from "vitest";
import { addRoot, removeRoot, useOpenProjects } from "./openProjectsStore";

// The suite runs in the "node" vitest env, which has no localStorage. The store
// persists tab state to it, so provide a minimal in-memory stub.
function installLocalStorage() {
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

describe("open-projects list ops", () => {
  it("addRoot appends unique and keeps order", () => {
    expect(addRoot(["/a"], "/b")).toEqual(["/a", "/b"]);
    expect(addRoot(["/a", "/b"], "/a")).toEqual(["/a", "/b"]);
  });
  it("removeRoot drops and picks a neighbor as next active", () => {
    const { roots, next } = removeRoot(["/a", "/b", "/c"], "/b", "/b");
    expect(roots).toEqual(["/a", "/c"]);
    expect(next).toBe("/c");
  });
  it("removeRoot keeps active when a different tab is closed", () => {
    const { next } = removeRoot(["/a", "/b"], "/a", "/b");
    expect(next).toBe("/b");
  });
});

describe("tab names (rename + persistence)", () => {
  beforeEach(() => {
    installLocalStorage();
    localStorage.clear();
    useOpenProjects.setState({ roots: [], activeRoot: null, names: {} });
  });

  it("rename sets a custom tab label", () => {
    const s = useOpenProjects.getState();
    s.open("/proj/api", "api");
    s.rename("/proj/api", "  Backend API  ");
    expect(useOpenProjects.getState().names["/proj/api"]).toBe("Backend API");
  });

  it("an empty rename clears the custom name (falls back to basename)", () => {
    const s = useOpenProjects.getState();
    s.open("/proj/api", "api");
    s.rename("/proj/api", "Backend");
    s.rename("/proj/api", "   ");
    expect(useOpenProjects.getState().names["/proj/api"]).toBeUndefined();
  });

  it("re-opening a project preserves its custom name", () => {
    const s = useOpenProjects.getState();
    s.open("/proj/api", "api");
    s.rename("/proj/api", "Backend");
    s.open("/proj/api", "api"); // e.g. user re-opens the same folder
    expect(useOpenProjects.getState().names["/proj/api"]).toBe("Backend");
  });

  it("rename persists to localStorage", () => {
    useOpenProjects.getState().open("/proj/api", "api");
    useOpenProjects.getState().rename("/proj/api", "Backend");
    const saved = JSON.parse(localStorage.getItem("cadre-open-projects") || "{}");
    expect(saved.names["/proj/api"]).toBe("Backend");
  });
});
