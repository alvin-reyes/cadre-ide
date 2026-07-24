import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { parseModels, type ProjectModels } from "../lib/engine/models";
import { reportError } from "../lib/reportError";

const manifestPath = (root: string) => `${root}/cadre.json`;

/** Read cadre.json as raw text; return "" on any error. */
async function readManifestRaw(root: string): Promise<string> {
  try {
    return await invoke<string>("read_file", { path: manifestPath(root) });
  } catch {
    return "";
  }
}

/**
 * Pure read-modify-write: splice `patch` into the manifest's `models` block and
 * return the FULL manifest JSON. Preserves all other keys (name, cadre,
 * createdAt, repos, tracker). Empty-string / undefined patch values delete their
 * key; an emptied models block is removed entirely. Corrupt/empty input → {}.
 */
export function mergeModelsIntoManifest(rawManifest: string, patch: Partial<ProjectModels>): string {
  let manifest: Record<string, unknown> = {};
  try {
    manifest = JSON.parse(rawManifest) ?? {};
  } catch {
    /* start from empty object */
  }
  const existing =
    manifest.models && typeof manifest.models === "object" && !Array.isArray(manifest.models)
      ? (manifest.models as Record<string, unknown>)
      : {};
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(existing)) {
    if (typeof v === "string" && v) next[k] = v;
  }
  for (const [k, v] of Object.entries(patch)) {
    if (typeof v === "string" && v) next[k] = v;
    else delete next[k];
  }
  if (Object.keys(next).length === 0) delete manifest.models;
  else manifest.models = next;
  return JSON.stringify(manifest, null, 2);
}

// ---------------------------------------------------------------------------
// Zustand store — holds the ACTIVE project's models. Mirrors reposStore/
// trackerStore: load(root) on open, setModels(root, patch) writes back.
// ---------------------------------------------------------------------------

interface ModelsState {
  models: ProjectModels;
  /** Read the active project's models from cadre.json. Tolerant. */
  load: (root: string) => Promise<void>;
  /** Merge a patch into cadre.json's models block and persist. Tolerant. */
  setModels: (root: string, patch: Partial<ProjectModels>) => Promise<void>;
}

export const useModelsStore = create<ModelsState>((set) => ({
  models: {},

  load: async (root: string) => {
    try {
      const raw = await readManifestRaw(root);
      set({ models: parseModels(raw) });
    } catch (e) {
      reportError("project models", e);
      set({ models: {} });
    }
  },

  setModels: async (root: string, patch: Partial<ProjectModels>) => {
    try {
      const raw = await readManifestRaw(root);
      const nextRaw = mergeModelsIntoManifest(raw, patch);
      await invoke("write_text_file", { path: manifestPath(root), content: nextRaw });
      set({ models: parseModels(nextRaw) });
    } catch (e) {
      reportError("project models", e);
    }
  },
}));
