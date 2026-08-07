import { describe, it, expect, beforeEach } from "vitest";
import { usePromptsStore, load } from "./promptsStore";
import { BUILTIN_PROMPTS } from "../lib/maintain/promptCatalog";

beforeEach(() => {
  try { localStorage.removeItem("cadre-prompts"); } catch { /* node env */ }
  usePromptsStore.setState({ userPrompts: [], favoriteIds: [] });
});

describe("promptsStore", () => {
  it("allPrompts merges catalog + user prompts", () => {
    usePromptsStore.getState().addPrompt({ title: "Mine", body: "do it", category: "Refactor" });
    const all = usePromptsStore.getState().allPrompts();
    expect(all.length).toBe(BUILTIN_PROMPTS.length + 1);
    expect(all.some((p) => p.title === "Mine" && !p.builtin)).toBe(true);
  });
  it("deletePrompt removes only user prompts, not builtins", () => {
    const builtinId = BUILTIN_PROMPTS[0].id;
    usePromptsStore.getState().deletePrompt(builtinId);
    expect(usePromptsStore.getState().allPrompts().some((p) => p.id === builtinId)).toBe(true);
    usePromptsStore.getState().addPrompt({ title: "Mine", body: "x", category: "Git" });
    const mineId = usePromptsStore.getState().userPrompts[0].id;
    usePromptsStore.getState().deletePrompt(mineId);
    expect(usePromptsStore.getState().userPrompts.length).toBe(0);
  });
  it("toggleFavorite toggles membership", () => {
    usePromptsStore.getState().toggleFavorite("test-add-failing");
    expect(usePromptsStore.getState().favoriteIds).toContain("test-add-failing");
    usePromptsStore.getState().toggleFavorite("test-add-failing");
    expect(usePromptsStore.getState().favoriteIds).not.toContain("test-add-failing");
  });
  it("load() defaults arrays for a partial/malformed-but-valid payload (no crash)", () => {
    // A valid-JSON-but-partial blob must not leave userPrompts/favoriteIds
    // undefined — otherwise the spreads in allPrompts/addPrompt throw
    // "not iterable" and the prompt library crashes on first use.
    for (const payload of ["{}", "null", '{"favoriteIds":["x"]}']) {
      try { localStorage.setItem("cadre-prompts", payload); } catch { /* node env */ }
      const state = load();
      expect(Array.isArray(state.userPrompts)).toBe(true);
      expect(Array.isArray(state.favoriteIds)).toBe(true);
      // Hydrate the store from load() and prove the crash paths are closed.
      usePromptsStore.setState({ userPrompts: state.userPrompts, favoriteIds: state.favoriteIds });
      expect(() => usePromptsStore.getState().allPrompts()).not.toThrow();
      expect(() =>
        usePromptsStore.getState().addPrompt({ title: "x", body: "y", category: "Git" }),
      ).not.toThrow();
    }
    // "null" and "{}" carry no favoriteIds → default to [].
    try { localStorage.setItem("cadre-prompts", "{}"); } catch { /* node env */ }
    expect(load()).toEqual({ userPrompts: [], favoriteIds: [] });
  });
});
