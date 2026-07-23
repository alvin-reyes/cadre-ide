import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Save, FileCode2, RefreshCw, SquareTerminal, X } from "lucide-react";
import MonacoWrapper from "../components/editor/MonacoWrapper";
import { FileTree } from "./FileTree";
import { TerminalTabs } from "./TerminalTabs";
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
  // Bumping reloadKey remounts the tree → re-lists from disk (no live watcher).
  // Manual only, so switching to the File view doesn't collapse expanded folders.
  const [reloadKey, setReloadKey] = useState(0);
  // Integrated terminal below the editor (IDE-style). Mounted once opened so its
  // PTY survives hide/show; resizable via the drag handle.
  const [termMounted, setTermMounted] = useState(false);
  const [termOpen, setTermOpen] = useState(false);
  const [termHeight, setTermHeight] = useState(240);
  const dirty = openPath != null && content !== saved;

  function toggleTerm() {
    setTermMounted(true);
    setTermOpen((v) => !v);
  }
  function onTermDrag(e: React.MouseEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = termHeight;
    const onMove = (ev: MouseEvent) => {
      const next = startH - (ev.clientY - startY);
      setTermHeight(Math.max(100, Math.min(window.innerHeight * 0.75, next)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  async function openFile(path: string) {
    if (path === openPath) return;
    // Don't silently discard unsaved edits when switching files.
    if (dirty && !window.confirm("Discard unsaved changes to the current file?")) return;
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
          onClick={toggleTerm}
          title="Toggle the integrated terminal"
          aria-label="Toggle terminal"
          aria-pressed={termOpen}
          className="cadre-hover"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: "var(--c-fs-xs)",
            fontWeight: 550 as const,
            padding: "4px 10px",
            borderRadius: "var(--c-radius-sm)",
            background: termOpen ? "var(--c-surface-3)" : "transparent",
            color: termOpen ? "var(--c-accent)" : "var(--c-text-muted)",
            border: "1px solid var(--c-border)",
            cursor: "pointer",
          }}
        >
          <SquareTerminal size={13} strokeWidth={2} />
          Terminal
        </button>
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

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {/* Explorer tree */}
        <div style={{ width: 240, flexShrink: 0, minHeight: 0, overflow: "auto", borderRight: "1px solid var(--c-border)", padding: "var(--c-space-2) 4px", background: "var(--c-surface-1)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 4px 8px 8px" }}>
            <span style={{ flex: 1, fontSize: "var(--c-fs-xs)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--c-text-muted)", fontWeight: 600 as const, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {relTo(root, root) === "." ? root.split("/").pop() : root}
            </span>
            <button
              onClick={() => setReloadKey((k) => k + 1)}
              title="Refresh the file tree"
              aria-label="Refresh the file tree"
              className="cadre-hover"
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: "var(--c-radius-sm)", background: "transparent", border: "none", color: "var(--c-text-muted)", cursor: "pointer", flexShrink: 0 }}
            >
              <RefreshCw size={13} strokeWidth={2} />
            </button>
          </div>
          {error && <div style={{ padding: "4px 8px", fontSize: "var(--c-fs-xs)", color: "var(--c-danger)" }}>{error}</div>}
          <FileTree key={reloadKey} root={root} onOpen={openFile} selected={openPath} />
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

      {/* Integrated terminal (IDE-style), below the editor. */}
      {termMounted && (
        <div style={{ display: termOpen ? "flex" : "none", flexDirection: "column", height: termHeight, flexShrink: 0, borderTop: "1px solid var(--c-border-strong)" }}>
          <div
            onMouseDown={onTermDrag}
            className="cadre-divider"
            title="Drag to resize"
            style={{ height: 6, cursor: "row-resize", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--c-surface-1)" }}
          >
            <div className="cadre-divider-line" style={{ width: 34, height: 2, borderRadius: 2, background: "var(--c-border-strong)" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px var(--c-space-3)", borderBottom: "1px solid var(--c-border)", background: "var(--c-surface-1)", flexShrink: 0 }}>
            <SquareTerminal size={13} strokeWidth={2} style={{ color: "var(--c-text-muted)" }} />
            <span style={{ fontSize: "var(--c-fs-xs)", fontWeight: 600 as const, color: "var(--c-text-secondary)" }}>Terminal</span>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => setTermOpen(false)}
              title="Hide terminal"
              aria-label="Hide terminal"
              className="cadre-hover"
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: "var(--c-radius-sm)", background: "transparent", border: "none", color: "var(--c-text-muted)", cursor: "pointer" }}
            >
              <X size={13} strokeWidth={2} />
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <TerminalTabs cwd={root} />
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
