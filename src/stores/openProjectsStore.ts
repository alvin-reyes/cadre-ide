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
}

export const useOpenProjects = create<OpenProjectsState>((set) => ({
  ...load(),
  open: (root, name) => {
    set((s) => {
      const roots = addRoot(s.roots, root);
      const names = { ...s.names, [root]: name };
      const st = { roots, activeRoot: root, names };
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
