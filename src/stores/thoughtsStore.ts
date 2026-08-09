/**
 * thoughtsStore — backs the Thoughts dock's history, saved notes, and templates.
 *
 *  - history: every sent thought, per project (so you can go back to what you ran).
 *  - notes:   named, saved thoughts you keep — global (reusable across projects).
 *  - templates: reusable snippets to insert — a built-in catalog + your own.
 *
 * All persisted to localStorage (guarded so it's safe under a node test env).
 */
import { create } from "zustand";
import { BUILTIN_THOUGHT_TEMPLATES, type ThoughtTemplate } from "../lib/maintain/thoughtTemplates";

export interface HistoryEntry { id: string; text: string; at: number; }
export interface Note { id: string; name: string; text: string; at: number; }

const H_KEY = "cadre-thoughts-history";
const N_KEY = "cadre-thoughts-notes";
const T_KEY = "cadre-thoughts-templates";
const HISTORY_CAP = 100;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}
function write(key: string, value: unknown): void {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}
function genId(): string {
  try { if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID(); } catch { /* fall through */ }
  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

interface ThoughtsStore {
  historyByRoot: Record<string, HistoryEntry[]>;
  notes: Note[];
  userTemplates: ThoughtTemplate[];
  history: (root: string) => HistoryEntry[];
  pushHistory: (root: string, text: string, at: number) => void;
  clearHistory: (root: string) => void;
  saveNote: (name: string, text: string, at: number) => void;
  deleteNote: (id: string) => void;
  allTemplates: () => ThoughtTemplate[];
  addTemplate: (name: string, body: string) => void;
  deleteTemplate: (id: string) => void;
}

export const useThoughtsStore = create<ThoughtsStore>((set, get) => ({
  historyByRoot: read<Record<string, HistoryEntry[]>>(H_KEY, {}),
  notes: read<Note[]>(N_KEY, []),
  userTemplates: read<ThoughtTemplate[]>(T_KEY, []),

  history: (root) => get().historyByRoot[root] ?? [],

  pushHistory: (root, text, at) => {
    const t = text.trim();
    if (!t) return;
    const cur = get().historyByRoot[root] ?? [];
    if (cur[0]?.text === t) return; // skip consecutive duplicates
    const next = [{ id: genId(), text: t, at }, ...cur].slice(0, HISTORY_CAP);
    const historyByRoot = { ...get().historyByRoot, [root]: next };
    write(H_KEY, historyByRoot);
    set({ historyByRoot });
  },
  clearHistory: (root) => {
    const historyByRoot = { ...get().historyByRoot, [root]: [] };
    write(H_KEY, historyByRoot);
    set({ historyByRoot });
  },

  saveNote: (name, text, at) => {
    const notes = [{ id: genId(), name: name.trim() || "Untitled", text, at }, ...get().notes];
    write(N_KEY, notes);
    set({ notes });
  },
  deleteNote: (id) => {
    const notes = get().notes.filter((n) => n.id !== id);
    write(N_KEY, notes);
    set({ notes });
  },

  allTemplates: () => [...BUILTIN_THOUGHT_TEMPLATES, ...get().userTemplates],
  addTemplate: (name, body) => {
    const userTemplates = [{ id: genId(), name: name.trim() || "Untitled", body, builtin: false }, ...get().userTemplates];
    write(T_KEY, userTemplates);
    set({ userTemplates });
  },
  deleteTemplate: (id) => {
    const userTemplates = get().userTemplates.filter((t) => t.id !== id);
    write(T_KEY, userTemplates);
    set({ userTemplates });
  },
}));
