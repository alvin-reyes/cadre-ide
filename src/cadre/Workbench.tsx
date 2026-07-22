import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolderTree, FileCode2, SquareTerminal, Folder, FileText, ChevronLeft } from "lucide-react";
import { TerminalPanel } from "./TerminalPanel";
import { Markdown } from "./components/Markdown";

/**
 * The Workbench: a real hands-on toolset for the CTO — a file browser, a code/
 * document viewer, and a terminal — wired to the actual filesystem via the Tauri
 * commands. This is the daily-driver IDE surface alongside planning + the fleet.
 */

interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export type WorkbenchTab = "files" | "code" | "terminal";

function relTo(root: string, path: string): string {
  return path.startsWith(root) ? path.slice(root.length).replace(/^\//, "") || "." : path;
}

export function Workbench({
  root,
  tab,
  onTab,
}: {
  root: string;
  tab: WorkbenchTab;
  onTab: (t: WorkbenchTab) => void;
}) {
  const [dir, setDir] = useState(root);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [file, setFile] = useState<{ path: string; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<DirEntry[]>("list_directory", { path: dir })
      .then((e) => {
        setEntries(
          [...e].sort((a, b) => (a.is_dir === b.is_dir ? a.name.localeCompare(b.name) : a.is_dir ? -1 : 1))
        );
        setError(null);
      })
      .catch((err) => setError(String(err)));
  }, [dir]);

  async function open(e: DirEntry) {
    if (e.is_dir) {
      setDir(e.path);
      return;
    }
    try {
      const content = await invoke<string>("read_file", { path: e.path });
      setFile({ path: e.path, content });
      onTab("code");
    } catch (err) {
      setError(String(err));
    }
  }

  const atRoot = dir === root;
  const tabs: { id: WorkbenchTab; icon: typeof FolderTree; label: string }[] = [
    { id: "files", icon: FolderTree, label: "Files" },
    { id: "code", icon: FileCode2, label: "Code" },
    { id: "terminal", icon: SquareTerminal, label: "Terminal" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--c-bg)" }}>
      {/* Tab rail */}
      <div style={{ display: "flex", alignItems: "center", gap: 2, padding: "4px 6px", borderBottom: "1px solid var(--c-border)", background: "var(--c-surface-1)", flexShrink: 0 }}>
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onTab(t.id)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: "var(--c-fs-xs)",
                fontWeight: 550 as const,
                padding: "4px 10px",
                borderRadius: "var(--c-radius-sm)",
                background: active ? "var(--c-surface-3)" : "transparent",
                color: active ? "var(--c-text)" : "var(--c-text-muted)",
                border: "1px solid transparent",
                cursor: "pointer",
              }}
            >
              <t.icon size={13} strokeWidth={2} />
              {t.label}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {tab === "files" && (
          <div style={{ flex: 1, overflow: "auto", padding: "var(--c-space-2)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 6px 8px", fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)", fontFamily: "var(--c-font-mono)" }}>
              {!atRoot && (
                <button
                  onClick={() => setDir(dir.slice(0, dir.lastIndexOf("/")) || root)}
                  title="Up"
                  style={{ display: "inline-flex", background: "transparent", border: "none", color: "var(--c-text-secondary)", cursor: "pointer", padding: 0 }}
                >
                  <ChevronLeft size={13} strokeWidth={2} />
                </button>
              )}
              /{relTo(root, dir) === "." ? "" : relTo(root, dir)}
            </div>
            {error && <div style={{ padding: "6px", fontSize: "var(--c-fs-xs)", color: "var(--c-danger)" }}>{error}</div>}
            {entries.map((e) => (
              <button
                key={e.path}
                onClick={() => open(e)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  width: "100%",
                  textAlign: "left",
                  padding: "4px 6px",
                  borderRadius: "var(--c-radius-sm)",
                  background: file?.path === e.path ? "var(--c-surface-2)" : "transparent",
                  border: "none",
                  color: "var(--c-text-secondary)",
                  fontSize: "var(--c-fs-sm)",
                  cursor: "pointer",
                }}
              >
                {e.is_dir ? (
                  <Folder size={14} strokeWidth={2} style={{ color: "var(--c-accent)", flexShrink: 0 }} />
                ) : (
                  <FileText size={14} strokeWidth={2} style={{ color: "var(--c-text-muted)", flexShrink: 0 }} />
                )}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</span>
              </button>
            ))}
            {entries.length === 0 && !error && (
              <div style={{ padding: "8px 6px", fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>Empty.</div>
            )}
          </div>
        )}

        {tab === "code" && (
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            {file ? (
              <>
                <div style={{ padding: "5px var(--c-space-3)", borderBottom: "1px solid var(--c-border)", fontSize: "var(--c-fs-xs)", fontFamily: "var(--c-font-mono)", color: "var(--c-text-secondary)", flexShrink: 0 }}>
                  {relTo(root, file.path)}
                </div>
                <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "var(--c-space-3)" }}>
                  {file.path.endsWith(".md") ? (
                    <Markdown className="cadre-doc" content={file.content} />
                  ) : (
                    <pre style={{ margin: 0, fontFamily: "var(--c-font-mono)", fontSize: "var(--c-fs-base)", lineHeight: 1.6, color: "var(--c-text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {file.content}
                    </pre>
                  )}
                </div>
              </>
            ) : (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--c-text-faint)", fontSize: "var(--c-fs-sm)" }}>
                Open a file from the Files tab.
              </div>
            )}
          </div>
        )}

        {tab === "terminal" && (
          <div style={{ flex: 1, minHeight: 0 }}>
            <TerminalPanel cwd={dir} />
          </div>
        )}
      </div>
    </div>
  );
}
