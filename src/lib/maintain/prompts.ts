/**
 * Prompt library model + pure helpers for the Maintain cockpit's intake.
 * A Prompt is a reusable task template. Helpers are pure so they unit-test
 * without a store; the store (promptsStore) owns persistence + CRUD.
 */

export type PromptCategory =
  | "Testing" | "Refactor" | "Debug" | "Review" | "Git"
  | "Docs" | "Dependencies" | "Performance" | "Security";

export interface Prompt {
  id: string;
  title: string;
  body: string;
  category: PromptCategory;
  builtin: boolean;
}

export interface PromptGroup {
  category: PromptCategory | "Favorites";
  prompts: Prompt[];
}

/** Category display order (also the group order). */
export const PROMPT_CATEGORIES: PromptCategory[] = [
  "Testing", "Refactor", "Debug", "Review", "Git",
  "Docs", "Dependencies", "Performance", "Security",
];

/** Case-insensitive substring match over title + body. Empty query → all. */
export function searchPrompts(prompts: Prompt[], query: string): Prompt[] {
  const q = query.trim().toLowerCase();
  if (!q) return prompts;
  return prompts.filter((p) => p.title.toLowerCase().includes(q) || p.body.toLowerCase().includes(q));
}

/**
 * Group prompts by category in PROMPT_CATEGORIES order, dropping empty groups.
 * Favorites (by id) are ALSO surfaced in a leading "Favorites" group; the
 * originals remain in their own category (a favorite shows twice, by design).
 */
export function groupByCategory(prompts: Prompt[], favoriteIds: string[]): PromptGroup[] {
  const groups: PromptGroup[] = [];
  const favSet = new Set(favoriteIds);
  const favs = prompts.filter((p) => favSet.has(p.id));
  if (favs.length) groups.push({ category: "Favorites", prompts: favs });
  for (const category of PROMPT_CATEGORIES) {
    const inCat = prompts.filter((p) => p.category === category);
    if (inCat.length) groups.push({ category, prompts: inCat });
  }
  return groups;
}
