import { create } from "zustand";

const KEY = "cadre-open-projects";

export function addRoot(roots: string[], root: string): string[] {
  return roots.includes(root) ? roots : [...roots, root];
}

export function removeRoot(roots: string[], root: string, active: string | null) {
  const idx = roots.indexOf(root);
  const next = roots.filter((r) => r !== root);
  const nextActive = active === root ? (next[Math.min(idx, next.length - 1)] ?? null) : active;
  return { roots: next, next: nextActive };
}

interface Persisted {
  roots: string[];
  activeRoot: string | null;
  names: Record<string, string>;
}

function load(): Persisted {
  try {
    return {
      roots: [],
      activeRoot: null,
      names: {},
      ...JSON.parse(localStorage.getItem(KEY) || "{}"),
    };
  } catch {
    return { roots: [], activeRoot: null, names: {} };
  }
}

function persist(p: Persisted) {
  localStorage.setItem(KEY, JSON.stringify(p));
}

interface OpenProjectsState extends Persisted {
  open: (root: string, name: string) => void;
  close: (root: string) => void;
  setActive: (root: string) => void;
  rename: (root: string, name: string) => void;
}

export const useOpenProjects = create<OpenProjectsState>((set) => ({
  ...load(),
  open: (root, name) => {
    set((s) => {
      const roots = addRoot(s.roots, root);
      // Preserve a user's custom tab name across re-opens; only seed the
      // default (folder basename) the first time a project is opened.
      const names = { ...s.names, [root]: s.names[root] ?? name };
      const st = { roots, activeRoot: root, names };
      persist(st);
      return st;
    });
  },
  rename: (root, name) => {
    set((s) => {
      const trimmed = name.trim();
      // Empty rename clears the custom name, falling back to the basename.
      const names = { ...s.names };
      if (trimmed) names[root] = trimmed;
      else delete names[root];
      const st = { roots: s.roots, activeRoot: s.activeRoot, names };
      persist(st);
      return st;
    });
  },
  close: (root) => {
    set((s) => {
      const { roots, next } = removeRoot(s.roots, root, s.activeRoot);
      const names = { ...s.names };
      delete names[root];
      const st = { roots, activeRoot: next, names };
      persist(st);
      return st;
    });
  },
  setActive: (root) =>
    set((s) => {
      const st = { roots: s.roots, activeRoot: root, names: s.names };
      persist(st);
      return st;
    }),
}));
