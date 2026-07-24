import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { parseRepos, type RepoRef } from "../lib/engine/repos";
import { useCadre } from "../cadre/useCadre";

// ---------------------------------------------------------------------------
// Pure ops — exported and framework-free so they're unit-testable without
// Zustand or Tauri.
// ---------------------------------------------------------------------------

/**
 * Add or replace a repo by id.
 * - If a repo with the same id exists, replace it in place (preserving order).
 * - Otherwise append.
 * - Immutable: always returns a new array.
 */
export function upsertRepo(list: RepoRef[], repo: RepoRef): RepoRef[] {
  const idx = list.findIndex((r) => r.id === repo.id);
  if (idx === -1) {
    return [...list, repo];
  }
  const next = [...list];
  next[idx] = repo;
  return next;
}

/**
 * Remove a repo by id.
 * - Immutable: always returns a new array.
 * - If the id is not found, returns a new array with the same contents.
 */
export function removeRepoFromList(list: RepoRef[], id: string): RepoRef[] {
  return list.filter((r) => r.id !== id);
}

// ---------------------------------------------------------------------------
// Persist helpers
// ---------------------------------------------------------------------------

/** Read cadre.json as raw text; return "" on any error. */
async function readManifestRaw(root: string): Promise<string> {
  try {
    return await invoke<string>("read_file", { path: `${root}/cadre.json` });
  } catch {
    return "";
  }
}

/**
 * Read the raw cadre.json, splice in the new `repos` array, and write back.
 * Preserves all other keys (name, cadre, createdAt, etc.).
 */
async function persistRepos(root: string, repos: RepoRef[]): Promise<void> {
  const raw = await readManifestRaw(root);
  let manifest: Record<string, unknown> = {};
  try {
    manifest = JSON.parse(raw) ?? {};
  } catch {
    /* start from empty object */
  }
  manifest.repos = repos;
  await invoke("write_text_file", {
    path: `${root}/cadre.json`,
    content: JSON.stringify(manifest, null, 2),
  });
}

// ---------------------------------------------------------------------------
// Zustand store
// ---------------------------------------------------------------------------

interface ReposState {
  repos: RepoRef[];
  /** Load repos from cadre.json at the given project root. */
  load: (root: string) => Promise<void>;
  /** Add or replace a repo in the registry (upsert by id), then persist. */
  addRepo: (root: string, repo: RepoRef) => Promise<void>;
  /** Remove a repo by id from the registry, then persist. */
  removeRepo: (root: string, id: string) => Promise<void>;
  /** Update the verify command for a specific repo, then persist. */
  setVerify: (root: string, id: string, verify: string) => Promise<void>;
}

export const useRepos = create<ReposState>((set, get) => ({
  repos: [],

  load: async (root: string) => {
    const raw = await readManifestRaw(root);
    const repos = parseRepos(raw);
    set({ repos });
  },

  addRepo: async (root: string, repo: RepoRef) => {
    const next = upsertRepo(get().repos, repo);
    await persistRepos(root, next);
    set({ repos: next });
    useCadre.getState().markNeedsReplan();
  },

  removeRepo: async (root: string, id: string) => {
    const next = removeRepoFromList(get().repos, id);
    await persistRepos(root, next);
    set({ repos: next });
    useCadre.getState().markNeedsReplan();
  },

  setVerify: async (root: string, id: string, verify: string) => {
    const current = get().repos.find((r) => r.id === id);
    if (!current) return;
    const updated: RepoRef = { ...current, ...(verify ? { verify } : {}) };
    if (!verify) delete updated.verify;
    const next = upsertRepo(get().repos, updated);
    await persistRepos(root, next);
    set({ repos: next });
  },
}));
