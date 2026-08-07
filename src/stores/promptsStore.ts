/**
 * promptsStore — the Maintain cockpit's prompt library. Global (prompts are
 * reusable across every project), persisted to localStorage. The built-in
 * catalog is read-only; users add/edit/delete their own and favorite any prompt
 * (built-in or user) by id.
 */
import { create } from "zustand";
import { BUILTIN_PROMPTS } from "../lib/maintain/promptCatalog";
import type { Prompt, PromptCategory } from "../lib/maintain/prompts";

const KEY = "cadre-prompts";

interface Persisted { userPrompts: Prompt[]; favoriteIds: string[]; }

export function load(): Persisted {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    // Merge defaults BEFORE the parsed payload so a partial/malformed-but-valid
    // JSON blob (e.g. "{}", "null", or an object missing a key) can never leave
    // userPrompts/favoriteIds undefined — that would make the spreads in
    // allPrompts/addPrompt throw "not iterable". Mirrors openProjectsStore.
    if (raw) return { userPrompts: [], favoriteIds: [], ...(JSON.parse(raw) as Partial<Persisted>) };
  } catch { /* corrupt or unavailable */ }
  return { userPrompts: [], favoriteIds: [] };
}

function persist(p: Persisted) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(p));
  } catch { /* quota / unavailable */ }
}

function genId(): string {
  try { if (typeof crypto !== "undefined" && crypto.randomUUID) return `u_${crypto.randomUUID()}`; } catch { /* fall through */ }
  return `u_${Math.random().toString(36).slice(2)}`;
}

interface PromptsStore {
  userPrompts: Prompt[];
  favoriteIds: string[];
  allPrompts: () => Prompt[];
  addPrompt: (input: { title: string; body: string; category: PromptCategory }) => void;
  updatePrompt: (id: string, patch: Partial<Pick<Prompt, "title" | "body" | "category">>) => void;
  deletePrompt: (id: string) => void;
  toggleFavorite: (id: string) => void;
}

export const usePromptsStore = create<PromptsStore>((set, get) => ({
  ...load(),
  allPrompts: () => [...BUILTIN_PROMPTS, ...get().userPrompts],
  addPrompt: ({ title, body, category }) => {
    const prompt: Prompt = { id: genId(), title, body, category, builtin: false };
    const userPrompts = [prompt, ...get().userPrompts];
    persist({ userPrompts, favoriteIds: get().favoriteIds });
    set({ userPrompts });
  },
  updatePrompt: (id, patch) => {
    const userPrompts = get().userPrompts.map((p) => (p.id === id ? { ...p, ...patch } : p));
    persist({ userPrompts, favoriteIds: get().favoriteIds });
    set({ userPrompts });
  },
  deletePrompt: (id) => {
    const userPrompts = get().userPrompts.filter((p) => p.id !== id);
    const favoriteIds = get().favoriteIds.filter((f) => f !== id);
    persist({ userPrompts, favoriteIds });
    set({ userPrompts, favoriteIds });
  },
  toggleFavorite: (id) => {
    const has = get().favoriteIds.includes(id);
    const favoriteIds = has ? get().favoriteIds.filter((f) => f !== id) : [...get().favoriteIds, id];
    persist({ userPrompts: get().userPrompts, favoriteIds });
    set({ favoriteIds });
  },
}));
