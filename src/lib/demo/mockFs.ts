/**
 * MockFs: an in-memory filesystem for demo mode.
 *
 * Keyed by absolute path strings → file content strings.
 * Directories are implicit (derived from the key set).
 * Matches the DirEntry shape used by the app: { name, path, is_dir }.
 */

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

/** Normalize: trim trailing slashes, ensure leading slash. */
function normalize(p: string): string {
  // Remove trailing slashes unless root
  let n = p.replace(/\/+$/, "") || "/";
  // Ensure leading slash for absolute paths
  if (!n.startsWith("/")) n = "/" + n;
  return n;
}

export class MockFs {
  private files: Map<string, string>;

  constructor(seed: Record<string, string> = {}) {
    this.files = new Map();
    for (const [path, content] of Object.entries(seed)) {
      this.files.set(normalize(path), content);
    }
  }

  /** Read file content; returns null if missing. */
  read(path: string): string | null {
    return this.files.get(normalize(path)) ?? null;
  }

  /** Write file content. Creates parent dirs implicitly. */
  write(path: string, content: string): void {
    this.files.set(normalize(path), content);
  }

  /** Check if a path exists (as a file). Directories are implied. */
  exists(path: string): boolean {
    const n = normalize(path);
    if (this.files.has(n)) return true;
    // Check if there's any file under this as a directory prefix
    const prefix = n === "/" ? "/" : n + "/";
    for (const k of this.files.keys()) {
      if (k.startsWith(prefix)) return true;
    }
    return false;
  }

  /** Mkdir — no-op since dirs are implicit in the key set. */
  mkdir(_path: string): void {
    // Directories are derived; no explicit action needed.
  }

  /**
   * List the direct children of a directory.
   * Returns both files and implied subdirectories (one level deep only).
   */
  list(dir: string): DirEntry[] {
    const d = normalize(dir);
    const prefix = d === "/" ? "/" : d + "/";
    const seen = new Set<string>();
    const result: DirEntry[] = [];

    for (const filePath of this.files.keys()) {
      if (!filePath.startsWith(prefix)) continue;
      const rest = filePath.slice(prefix.length);
      const slashIdx = rest.indexOf("/");
      if (slashIdx === -1) {
        // Direct file child
        if (!seen.has(filePath)) {
          seen.add(filePath);
          result.push({ name: basename(filePath), path: filePath, is_dir: false });
        }
      } else {
        // Implied subdirectory
        const subdirName = rest.slice(0, slashIdx);
        const subdirPath = prefix + subdirName;
        if (!seen.has(subdirPath)) {
          seen.add(subdirPath);
          result.push({ name: subdirName, path: subdirPath, is_dir: true });
        }
      }
    }

    return result;
  }

  /** Remove a file. No-op if missing. */
  remove(path: string): void {
    this.files.delete(normalize(path));
  }

  /** Internal: iterate all files (for search). */
  entries(): IterableIterator<[string, string]> {
    return this.files.entries();
  }

  /** Return all file paths. */
  allPaths(): string[] {
    return Array.from(this.files.keys());
  }

  /** Snapshot of current state (for debugging/testing). */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.files.entries());
  }
}
