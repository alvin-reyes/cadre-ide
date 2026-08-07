import { describe, it, expect, beforeEach } from "vitest";
import { usePromptsStore } from "./promptsStore";
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
});
