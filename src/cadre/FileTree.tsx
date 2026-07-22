import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronRight, Folder, FolderOpen, FileText } from "lucide-react";

/**
 * An expandable project folder tree (lazy-loads children on expand) wired to the
 * real filesystem via list_directory. Clicking a file calls onOpen.
 */

interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

const IGNORE = new Set([".git", ".DS_Store"]);

function sortEntries(e: DirEntry[]): DirEntry[] {
  return [...e]
    .filter((x) => !IGNORE.has(x.name))
    .sort((a, b) => (a.is_dir === b.is_dir ? a.name.localeCompare(b.name) : a.is_dir ? -1 : 1));
}

export function FileTree({
  root,
  onOpen,
  selected,
}: {
  root: string;
  onOpen: (path: string) => void;
  selected: string | null;
}) {
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    invoke<DirEntry[]>("list_directory", { path: root })
      .then((e) => {
        setEntries(sortEntries(e));
        setErr(null);
      })
      .catch((e) => setErr(String(e)));
  }, [root]);

  if (err) return <div style={{ padding: 8, fontSize: "var(--c-fs-xs)", color: "var(--c-danger)" }}>{err}</div>;
  return (
    <div>
      {entries.map((e) => (
        <TreeNode key={e.path} entry={e} depth={0} onOpen={onOpen} selected={selected} />
      ))}
      {entries.length === 0 && !err && (
        <div style={{ padding: "8px 6px", fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>Empty project.</div>
      )}
    </div>
  );
}

function TreeNode({
  entry,
  depth,
  onOpen,
  selected,
}: {
  entry: DirEntry;
  depth: number;
  onOpen: (path: string) => void;
  selected: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);

  async function toggle() {
    if (!entry.is_dir) {
      onOpen(entry.path);
      return;
    }
    if (!open && children === null) {
      const e = await invoke<DirEntry[]>("list_directory", { path: entry.path }).catch(() => [] as DirEntry[]);
      setChildren(sortEntries(e));
    }
    setOpen((o) => !o);
  }

  const isSel = selected === entry.path;
  return (
    <>
      <button
        onClick={toggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          width: "100%",
          textAlign: "left",
          padding: "3px 6px",
          paddingLeft: 6 + depth * 13,
          background: isSel ? "var(--c-surface-2)" : "transparent",
          border: "none",
          color: isSel ? "var(--c-text)" : "var(--c-text-secondary)",
          fontSize: "var(--c-fs-sm)",
          cursor: "pointer",
        }}
      >
        {entry.is_dir ? (
          <ChevronRight
            size={12}
            strokeWidth={2}
            style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform var(--c-dur-fast) var(--c-ease-out)", flexShrink: 0, color: "var(--c-text-muted)" }}
          />
        ) : (
          <span style={{ width: 12, flexShrink: 0 }} />
        )}
        {entry.is_dir ? (
          open ? (
            <FolderOpen size={13} strokeWidth={2} style={{ color: "var(--c-accent)", flexShrink: 0 }} />
          ) : (
            <Folder size={13} strokeWidth={2} style={{ color: "var(--c-accent)", flexShrink: 0 }} />
          )
        ) : (
          <FileText size={13} strokeWidth={2} style={{ color: "var(--c-text-muted)", flexShrink: 0 }} />
        )}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</span>
      </button>
      {entry.is_dir && open && children?.map((c) => (
        <TreeNode key={c.path} entry={c} depth={depth + 1} onOpen={onOpen} selected={selected} />
      ))}
    </>
  );
}
