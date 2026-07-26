/**
 * loadLocalFolder.ts — Web-only "open a local folder" support.
 *
 * On the desktop build, folders are picked via the Tauri dialog plugin and read
 * by the Rust backend. On the WEB build there is no backend, so we use the
 * browser File System Access API (`showDirectoryPicker`) to let the user pick a
 * real local directory, then read its files into the active MockFs so every
 * downstream `invoke("read_file" | "list_directory" | …)` transparently serves
 * the real project files.
 *
 * INSECURE / TEST ONLY: this reads arbitrary local files into memory in the
 * browser. It exists so the UX can be exercised against a real project folder
 * without the desktop shell. It is a no-op under real Tauri.
 */

import type { MockFs } from "./mockFs";

// Directories we never want to slurp into memory (huge / irrelevant).
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "target",
  ".next",
  ".cache",
  "coverage",
  ".turbo",
  ".vite",
]);

// Only read files up to this size as text (skip large binaries/blobs).
const MAX_FILE_BYTES = 2_000_000; // 2 MB

// A stable virtual root for the loaded folder inside the MockFs. The app treats
// this as the project root; all files are stored under it.
export const WEB_PROJECT_ROOT = "/web-project";

/** True when the File System Access folder picker is available. */
export function canPickLocalFolder(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

interface FsDirHandle {
  name: string;
  values(): AsyncIterable<FsDirHandle | FsFileHandle>;
  kind: "directory";
}
interface FsFileHandle {
  name: string;
  kind: "file";
  getFile(): Promise<File>;
}

/**
 * Prompt the user to pick a local folder, recursively read its text files into
 * `fs` under WEB_PROJECT_ROOT, and return the virtual root path + display name.
 *
 * Returns null if the user cancels or the API is unavailable.
 */
export async function pickAndLoadLocalFolder(
  fs: MockFs
): Promise<{ root: string; name: string } | null> {
  if (!canPickLocalFolder()) return null;

  let dir: FsDirHandle;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dir = await (window as any).showDirectoryPicker({ mode: "read" });
  } catch {
    // User cancelled the picker, or permission denied.
    return null;
  }

  await readDirInto(fs, dir, WEB_PROJECT_ROOT);

  // Ensure a cadre.json exists so the app treats this as a project even if the
  // picked folder isn't a Cadre project yet (test convenience).
  if (fs.read(`${WEB_PROJECT_ROOT}/cadre.json`) === null) {
    fs.write(
      `${WEB_PROJECT_ROOT}/cadre.json`,
      JSON.stringify({ cadre: "0.1", name: dir.name, web: true }, null, 2)
    );
  }

  return { root: WEB_PROJECT_ROOT, name: dir.name };
}

/** Recursively read a directory handle's files into `fs` under `basePath`. */
async function readDirInto(
  fs: MockFs,
  dir: FsDirHandle,
  basePath: string
): Promise<void> {
  for await (const entry of dir.values()) {
    const path = `${basePath}/${entry.name}`;
    if (entry.kind === "directory") {
      if (SKIP_DIRS.has(entry.name)) continue;
      await readDirInto(fs, entry as FsDirHandle, path);
    } else {
      try {
        const file = await (entry as FsFileHandle).getFile();
        if (file.size > MAX_FILE_BYTES) continue;
        const text = await file.text();
        fs.write(path, text);
      } catch {
        // Unreadable file (permissions / binary) — skip it.
      }
    }
  }
}
