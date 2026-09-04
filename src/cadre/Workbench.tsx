import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Save, FileCode2, RefreshCw, SquareTerminal, X, Files, Search, Eye, Code2 } from "lucide-react";
import MonacoWrapper from "../components/editor/MonacoWrapper";
import { FileTree } from "./FileTree";
import { SearchPanel } from "./SearchPanel";
import { TerminalTabs } from "./TerminalTabs";
import { useThemeStore } from "../stores/themeStore";
import { toast } from "../stores/toastStore";
import { reportError } from "../lib/reportError";
import { viewerKind } from "../lib/viewer/viewerKind";
import { DocViewer } from "./viewer/DocViewer";

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
  // Left panel switches between the file tree and project-wide search/replace.
  const [leftMode, setLeftMode] = useState<"files" | "search">("files");
  // Bumping `nonce` re-triggers the editor's reveal-line even for the same target.
  const [gotoLine, setGotoLine] = useState<{ line: number; col?: number; nonce: number } | null>(null);
  // Markdown opens rendered (reading is the common case) but stays editable via
  // this toggle — the Source pane is the unchanged Monaco + Cmd+S flow.
  const [mdSource, setMdSource] = useState(false);
  const kind = openPath ? viewerKind(openPath) : "text";
  const isMarkdown = kind === "markdown";
  // Markdown in Source mode is the only non-"text" kind that still uses Monaco.
  const usesEditor = kind === "text" || (isMarkdown && mdSource);
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
      // Binary formats are read by DocViewer itself (read_file_base64);
      // read_file would fail here on invalid UTF-8.
      const text = viewerKind(path) === "text" || viewerKind(path) === "markdown"
        ? await invoke<string>("read_file", { path })
        : "";
      setOpenPath(path);
      setMdSource(false);
      setContent(text);
      setSaved(text);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  // Open a file (if not already open) and jump the editor to a line/col — used by
  // search results. Bump the nonce each time so re-clicking the same line re-reveals.
  async function openAt(path: string, line: number, col: number) {
    if (path !== openPath) await openFile(path);
    // openFile defaults markdown to Rendered mode, which unmounts Monaco —
    // a line/col jump only means anything in the Source (Monaco) pane, so
    // force it before revealing, or the jump below is silently a no-op.
    if (viewerKind(path) === "markdown") setMdSource(true);
    setGotoLine({ line, col, nonce: Date.now() });
  }

  async function save() {
    if (!openPath || content === saved) return;
    try {
      await invoke("write_text_file", { path: openPath, content });
      setSaved(content);
      toast(`Saved ${relTo(root, openPath)}`, "success");
    } catch (e) {
      setError(String(e));
      reportError("save file", e);
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
        {isMarkdown && (
          <button
            onClick={() => setMdSource((v) => !v)}
            title={mdSource ? "Show rendered Markdown" : "Edit Markdown source"}
            aria-pressed={mdSource}
            className="cadre-hover"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "var(--c-fs-xs)", fontWeight: 550 as const, padding: "4px 10px", borderRadius: "var(--c-radius-sm)", background: "transparent", color: "var(--c-text-muted)", border: "1px solid var(--c-border)", cursor: "pointer" }}
          >
            {mdSource ? <Eye size={12} strokeWidth={2} /> : <Code2 size={12} strokeWidth={2} />}
            {mdSource ? "Rendered" : "Source"}
          </button>
        )}
        {usesEditor && (
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
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {/* Explorer / Search panel */}
        <div style={{ width: 260, flexShrink: 0, minHeight: 0, display: "flex", flexDirection: "column", borderRight: "1px solid var(--c-border)", background: "var(--c-surface-1)" }}>
          {/* Files / Search mode switch */}
          <div style={{ display: "flex", alignItems: "center", gap: 2, padding: "6px 6px 4px", flexShrink: 0 }}>
            {([["files", Files, "Explorer"], ["search", Search, "Search"]] as const).map(([mode, Icon, label]) => {
              const on = leftMode === mode;
              return (
                <button
                  key={mode}
                  onClick={() => setLeftMode(mode)}
                  title={label}
                  aria-pressed={on}
                  className="cadre-hover"
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "var(--c-fs-xs)", fontWeight: 550 as const, padding: "4px 9px", borderRadius: "var(--c-radius-sm)", background: on ? "var(--c-surface-3)" : "transparent", color: on ? "var(--c-text)" : "var(--c-text-muted)", border: "none", cursor: "pointer" }}
                >
                  <Icon size={13} strokeWidth={2} />
                  {label}
                </button>
              );
            })}
          </div>

          {leftMode === "files" ? (
            <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "0 4px 8px" }}>
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
          ) : (
            <SearchPanel root={root} onOpen={openAt} />
          )}
        </div>

        {/* Editor */}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          {!openPath ? (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--c-text-faint)", fontSize: "var(--c-fs-sm)", textAlign: "center", padding: "var(--c-space-5)" }}>
              Select a file in the tree to view and edit it.
            </div>
          ) : usesEditor ? (
            <MonacoWrapper
              filePath={openPath}
              content={content}
              onChange={setContent}
              onSave={save}
              theme={theme === "light" ? "vs" : "vs-dark"}
              gotoLine={gotoLine}
            />
          ) : (
            // Pass the live editor buffer for markdown so the Rendered pane
            // reflects unsaved Source edits, instead of DocViewer re-reading
            // the same file from disk over a second IPC round-trip.
            <DocViewer path={openPath} text={isMarkdown ? content : undefined} />
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
