import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import {
  ADR_DECISIONS_DIR,
  type AdrStatus,
  adrFilename,
  composeAdr,
  nextAdrNumber,
  parseAdr,
} from "../lib/engine/adr";
import { reportError } from "../lib/reportError";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContextKind = "context" | "adr";

export interface ContextEntry {
  path: string; // repo-relative, e.g. ".cadre/context/auth-api.md"
  content: string;
  kind: ContextKind;
  // ADR-only fields, populated via parseAdr when kind === "adr":
  number?: number;
  title?: string;
  status?: AdrStatus;
}

interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

// ---------------------------------------------------------------------------
// Pure helper — exported and framework-free so it's unit-testable
// ---------------------------------------------------------------------------

/**
 * Merge context files and ADR files into a sorted `ContextEntry[]`:
 * - Context files come first, sorted alphabetically by filename.
 * - ADRs come after, sorted by number ascending.
 *
 * @param contextFiles  `{ name, content }[]` for `.cadre/context/*.md` (no dirs)
 * @param adrFiles      `{ name, content }[]` for `.cadre/context/decisions/*.md`
 */
export function toEntries(
  contextFiles: { name: string; content: string }[],
  adrFiles: { name: string; content: string }[]
): ContextEntry[] {
  // Build context entries — sorted alphabetically by filename.
  const contextEntries: ContextEntry[] = contextFiles
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ name, content }) => ({
      path: `.cadre/context/${name}`,
      content,
      kind: "context" as ContextKind,
    }));

  // Build ADR entries — parsed via parseAdr, sorted by number.
  const adrEntries: ContextEntry[] = adrFiles
    .map(({ name, content }) => {
      const parsed = parseAdr(content);
      const entry: ContextEntry = {
        path: `${ADR_DECISIONS_DIR}/${name}`,
        content,
        kind: "adr",
      };
      if (parsed) {
        entry.number = parsed.number;
        entry.title = parsed.title;
        entry.status = parsed.status;
      } else {
        // Fall back to filename: extract number from "NNNN-slug.md"
        const m = name.match(/^(\d+)-(.+)\.md$/);
        if (m) {
          entry.number = Number(m[1]);
          entry.title = m[2].replace(/-/g, " ");
        }
      }
      return entry;
    })
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0));

  return [...contextEntries, ...adrEntries];
}

// ---------------------------------------------------------------------------
// Zustand store — Tauri-glue
// ---------------------------------------------------------------------------

interface ContextState {
  root: string | null;
  entries: ContextEntry[];
  load: (root: string) => Promise<void>;
  saveFile: (root: string, path: string, content: string) => Promise<void>;
  newAdr: (
    root: string,
    draft: {
      title: string;
      context: string;
      decision: string;
      consequences: string;
    }
  ) => Promise<string>;
}

export const useContextStore = create<ContextState>((set, get) => ({
  root: null,
  entries: [],

  load: async (root: string) => {
    // List top-level context files (skip directories).
    let contextFiles: { name: string; content: string }[] = [];
    try {
      const items = await invoke<DirEntry[]>("list_directory", {
        path: `${root}/.cadre/context`,
      });
      const mdFiles = items.filter((e) => !e.is_dir && e.name.endsWith(".md"));
      contextFiles = await Promise.all(
        mdFiles.map(async (e) => {
          try {
            const content = await invoke<string>("read_file", { path: e.path });
            return { name: e.name, content };
          } catch (err) {
            reportError("context store: read file", err);
            return { name: e.name, content: "" };
          }
        })
      );
    } catch {
      // No .cadre/context directory yet — start empty, no error.
    }

    // List ADR files under decisions/.
    let adrFiles: { name: string; content: string }[] = [];
    try {
      const items = await invoke<DirEntry[]>("list_directory", {
        path: `${root}/${ADR_DECISIONS_DIR}`,
      });
      const mdFiles = items.filter((e) => !e.is_dir && e.name.endsWith(".md"));
      adrFiles = await Promise.all(
        mdFiles.map(async (e) => {
          try {
            const content = await invoke<string>("read_file", { path: e.path });
            return { name: e.name, content };
          } catch (err) {
            reportError("context store: read adr", err);
            return { name: e.name, content: "" };
          }
        })
      );
    } catch {
      // No decisions directory yet — start empty, no error.
    }

    const entries = toEntries(contextFiles, adrFiles);
    set({ root, entries });
  },

  saveFile: async (root: string, path: string, content: string) => {
    try {
      await invoke("write_text_file", { path: `${root}/${path}`, content });
      await get().load(root);
    } catch (err) {
      reportError("context store: save file", err);
    }
  },

  newAdr: async (
    root: string,
    draft: {
      title: string;
      context: string;
      decision: string;
      consequences: string;
    }
  ): Promise<string> => {
    try {
      const existing = get()
        .entries.filter((e) => e.kind === "adr")
        .map((e) => e.number!);
      const n = nextAdrNumber(existing);
      // Date is computed here in the store — keeps adr.ts pure.
      const date = new Date().toISOString().slice(0, 10);
      const adr = {
        number: n,
        title: draft.title,
        status: "Accepted" as const,
        date,
        context: draft.context,
        decision: draft.decision,
        consequences: draft.consequences,
      };
      const content = composeAdr(adr);
      const relPath = adrFilename(n, draft.title);
      await invoke("write_text_file", {
        path: `${root}/${relPath}`,
        content,
      });
      await get().load(root);
      return relPath;
    } catch (err) {
      reportError("context store: new ADR", err);
      return "";
    }
  },
}));
