import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Save, FileCode2 } from "lucide-react";
import MonacoWrapper from "../components/editor/MonacoWrapper";
import { FileTree } from "./FileTree";
import { useThemeStore } from "../stores/themeStore";
import { toast } from "../stores/toastStore";

/**
 * The File View: the project structure (tree) beside a real code editor (Monaco),
 * so the CTO can browse and EDIT files. One of the three main views (see CadreApp).
 * Ctrl/Cmd+S saves via the write_text_file Tauri command.
 */

function relTo(root: string, path: string): string {
  return path.startsWith(root) ? path.slice(root.length).replace(/^\//, "") || "." : path;
}

export function Workbench({ root }: { root: string }) {
  const theme = useThemeStore((s) => s.theme);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState(""); // last-persisted content
  const [error, setError] = useState<string | null>(null);
  const dirty = openPath != null && content !== saved;

  async function openFile(path: string) {
    try {
      const text = await invoke<string>("read_file", { path });
      setOpenPath(path);
      setContent(text);
      setSaved(text);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  async function save() {
    if (!openPath || content === saved) return;
    try {
      await invoke("write_text_file", { path: openPath, content });
      setSaved(content);
      toast(`Saved ${relTo(root, openPath)}`, "success");
    } catch (e) {
      setError(String(e));
      toast("Save failed", "error");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--c-bg)" }}>
      {/* Editor header — path + dirty state + Save */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px var(--c-space-3)", borderBottom: "1px solid var(--c-border)", background: "var(--c-surface-1)", flexShrink: 0 }}>
        <FileCode2 size={14} strokeWidth={2} style={{ color: "var(--c-text-muted)", flexShrink: 0 }} />
        <span style={{ fontSize: "var(--c-fs-xs)", fontFamily: "var(--c-font-mono)", color: openPath ? "var(--c-text-secondary)" : "var(--c-text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {openPath ? relTo(root, openPath) : "No file open"}
        </span>
        {dirty && <span title="Unsaved changes" style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--c-accent)", flexShrink: 0 }} />}
        <div style={{ flex: 1 }} />
        <button
          onClick={save}
          disabled={!dirty}
          title="Save (Ctrl/Cmd+S)"
          aria-label="Save file"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: "var(--c-fs-xs)",
            fontWeight: 550 as const,
            padding: "4px 10px",
            borderRadius: "var(--c-radius-sm)",
            background: dirty ? "var(--c-accent)" : "var(--c-surface-2)",
            color: dirty ? "var(--c-on-accent)" : "var(--c-text-muted)",
            border: "none",
            cursor: dirty ? "pointer" : "default",
          }}
        >
          <Save size={12} strokeWidth={2} />
          Save
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {/* Explorer tree */}
        <div style={{ width: 240, flexShrink: 0, minHeight: 0, overflow: "auto", borderRight: "1px solid var(--c-border)", padding: "var(--c-space-2) 4px", background: "var(--c-surface-1)" }}>
          <div style={{ padding: "2px 8px 8px", fontSize: "var(--c-fs-xs)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--c-text-muted)", fontWeight: 600 as const, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {relTo(root, root) === "." ? root.split("/").pop() : root}
          </div>
          {error && <div style={{ padding: "4px 8px", fontSize: "var(--c-fs-xs)", color: "var(--c-danger)" }}>{error}</div>}
          <FileTree root={root} onOpen={openFile} selected={openPath} />
        </div>

        {/* Editor */}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          {openPath ? (
            <MonacoWrapper
              filePath={openPath}
              content={content}
              onChange={setContent}
              onSave={save}
              theme={theme === "light" ? "vs" : "vs-dark"}
            />
          ) : (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--c-text-faint)", fontSize: "var(--c-fs-sm)", textAlign: "center", padding: "var(--c-space-5)" }}>
              Select a file in the tree to view and edit it.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
