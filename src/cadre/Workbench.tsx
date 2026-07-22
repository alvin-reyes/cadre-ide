import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolderTree, FileCode2, SquareTerminal } from "lucide-react";
import { TerminalPanel } from "./TerminalPanel";
import { Markdown } from "./components/Markdown";
import { FileTree } from "./FileTree";

/**
 * The Workbench: a real hands-on toolset for the CTO — a project folder TREE, a
 * code/document viewer, and a terminal — wired to the actual filesystem via the
 * Tauri commands. The daily-driver IDE surface alongside planning + the fleet.
 */

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
  const [file, setFile] = useState<{ path: string; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function openFile(path: string) {
    try {
      const content = await invoke<string>("read_file", { path });
      setFile({ path, content });
      setError(null);
      onTab("code");
    } catch (err) {
      setError(String(err));
    }
  }

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
          <div style={{ flex: 1, overflow: "auto", padding: "var(--c-space-2) 4px" }}>
            <div style={{ padding: "2px 8px 8px", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--c-text-muted)", fontWeight: 600 as const }}>
              {relTo(root, root) === "." ? root.split("/").pop() : root}
            </div>
            {error && <div style={{ padding: "4px 8px", fontSize: "var(--c-fs-xs)", color: "var(--c-danger)" }}>{error}</div>}
            <FileTree root={root} onOpen={openFile} selected={file?.path ?? null} />
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
                Click a file in the Files tree.
              </div>
            )}
          </div>
        )}

        {tab === "terminal" && (
          <div style={{ flex: 1, minHeight: 0 }}>
            <TerminalPanel cwd={root} />
          </div>
        )}
      </div>
    </div>
  );
}
