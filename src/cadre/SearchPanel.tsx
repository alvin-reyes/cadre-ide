import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Replace, CaseSensitive, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "../stores/toastStore";

/**
 * Project-wide search & replace across every text file in the folder (VS Code-style
 * "search all in folder" / "replace all in folder"). Backed by the search_in_files /
 * replace_in_files Tauri commands (literal match, no regex). Clicking a result opens
 * the file at that line in the editor.
 */

interface SearchMatch {
  line: number;
  col: number;
  count: number;
  preview: string;
}
interface FileMatches {
  path: string;
  matches: SearchMatch[];
}

function relTo(root: string, path: string): string {
  return path.startsWith(root) ? path.slice(root.length).replace(/^\//, "") || "." : path;
}

// Split a line around the (first, case-insensitive or exact) query so we can bold the hit.
function highlight(preview: string, query: string, caseSensitive: boolean) {
  if (!query) return preview;
  const hay = caseSensitive ? preview : preview.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const i = hay.indexOf(needle);
  if (i < 0) return preview;
  return (
    <>
      {preview.slice(0, i)}
      <mark style={{ background: "var(--c-accent-soft, rgba(120,150,255,0.28))", color: "inherit", borderRadius: 2, padding: "0 1px" }}>
        {preview.slice(i, i + query.length)}
      </mark>
      {preview.slice(i + query.length)}
    </>
  );
}

export function SearchPanel({ root, onOpen }: { root: string; onOpen: (path: string, line: number, col: number) => void }) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [results, setResults] = useState<FileMatches[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const totalMatches = results?.reduce((n, f) => n + f.matches.reduce((m, x) => m + x.count, 0), 0) ?? 0;

  async function runSearch() {
    if (!query) {
      setResults(null);
      return;
    }
    setBusy(true);
    try {
      const res = await invoke<FileMatches[]>("search_in_files", { root, query, caseSensitive });
      setResults(res);
      setCollapsed(new Set());
    } catch (e) {
      toast(`Search failed: ${e}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function runReplaceAll() {
    if (!query) return;
    if (!window.confirm(`Replace all ${totalMatches} occurrence(s) of “${query}” with “${replacement}” across the folder? This edits files on disk.`)) return;
    setBusy(true);
    try {
      const r = await invoke<{ files_changed: number; replacements: number }>("replace_in_files", {
        root,
        query,
        replacement,
        caseSensitive,
      });
      toast(`Replaced ${r.replacements} occurrence(s) in ${r.files_changed} file(s)`, "success");
      await runSearch(); // refresh (busy already true; runSearch resets it)
    } catch (e) {
      toast(`Replace failed: ${e}`, "error");
      setBusy(false);
    }
  }

  function toggleFile(path: string) {
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  const inputStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    fontSize: "var(--c-fs-xs)",
    fontFamily: "var(--c-font-mono)",
    padding: "5px 7px",
    borderRadius: "var(--c-radius-sm)",
    background: "var(--c-surface-2)",
    border: "1px solid var(--c-border)",
    color: "var(--c-text)",
    outline: "none",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Query row */}
      <div style={{ padding: "8px 8px 6px", display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            onClick={() => setShowReplace((v) => !v)}
            title={showReplace ? "Hide replace" : "Show replace"}
            aria-label="Toggle replace"
            className="cadre-hover"
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 28, background: "transparent", border: "none", color: "var(--c-text-muted)", cursor: "pointer", flexShrink: 0 }}
          >
            {showReplace ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
            placeholder="Search folder…"
            autoFocus
            style={inputStyle}
          />
          <button
            onClick={() => setCaseSensitive((v) => !v)}
            title="Match case"
            aria-pressed={caseSensitive}
            className="cadre-hover"
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 28, borderRadius: "var(--c-radius-sm)", background: caseSensitive ? "var(--c-accent)" : "transparent", color: caseSensitive ? "var(--c-on-accent)" : "var(--c-text-muted)", border: "1px solid var(--c-border)", cursor: "pointer", flexShrink: 0 }}
          >
            <CaseSensitive size={15} strokeWidth={2} />
          </button>
        </div>

        {showReplace && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, paddingLeft: 24 }}>
            <input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runReplaceAll()}
              placeholder="Replace with…"
              style={inputStyle}
            />
            <button
              onClick={runReplaceAll}
              disabled={busy || !query || totalMatches === 0}
              title="Replace all in folder"
              aria-label="Replace all in folder"
              className="cadre-hover"
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 28, borderRadius: "var(--c-radius-sm)", background: "transparent", color: "var(--c-text-muted)", border: "1px solid var(--c-border)", cursor: busy || !query || totalMatches === 0 ? "default" : "pointer", opacity: busy || !query || totalMatches === 0 ? 0.5 : 1, flexShrink: 0 }}
            >
              <Replace size={14} strokeWidth={2} />
            </button>
          </div>
        )}
      </div>

      {/* Summary */}
      <div style={{ padding: "0 12px 6px", fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)", flexShrink: 0, display: "flex", alignItems: "center", gap: 6, minHeight: 16 }}>
        {busy && <Loader2 size={12} className="cadre-spin" style={{ animation: "cadre-spin 0.8s linear infinite" }} />}
        {results != null && !busy && (
          <span>
            {totalMatches} result{totalMatches === 1 ? "" : "s"} in {results.length} file{results.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {/* Results */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "0 2px 8px" }}>
        {results?.map((file) => {
          const open = !collapsed.has(file.path);
          const fileCount = file.matches.reduce((m, x) => m + x.count, 0);
          return (
            <div key={file.path}>
              <button
                onClick={() => toggleFile(file.path)}
                className="cadre-hover"
                style={{ display: "flex", alignItems: "center", gap: 3, width: "100%", padding: "3px 6px", background: "transparent", border: "none", color: "var(--c-text-secondary)", cursor: "pointer", textAlign: "left" }}
              >
                {open ? <ChevronDown size={12} style={{ flexShrink: 0 }} /> : <ChevronRight size={12} style={{ flexShrink: 0 }} />}
                <span style={{ flex: 1, fontSize: "var(--c-fs-xs)", fontFamily: "var(--c-font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl", textAlignLast: "left" }}>
                  {relTo(root, file.path)}
                </span>
                <span style={{ flexShrink: 0, fontSize: "var(--c-fs-2xs, 10px)", background: "var(--c-surface-3)", color: "var(--c-text-muted)", borderRadius: 8, padding: "0 6px", minWidth: 16, textAlign: "center" }}>
                  {fileCount}
                </span>
              </button>
              {open &&
                file.matches.map((m, i) => (
                  <button
                    key={i}
                    onClick={() => onOpen(file.path, m.line, m.col)}
                    className="cadre-hover"
                    title={`Line ${m.line}`}
                    style={{ display: "flex", alignItems: "baseline", gap: 8, width: "100%", padding: "2px 6px 2px 24px", background: "transparent", border: "none", color: "var(--c-text-muted)", cursor: "pointer", textAlign: "left" }}
                  >
                    <span style={{ flexShrink: 0, fontSize: "var(--c-fs-2xs, 10px)", color: "var(--c-text-faint)", fontFamily: "var(--c-font-mono)", minWidth: 26, textAlign: "right" }}>{m.line}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: "var(--c-fs-xs)", fontFamily: "var(--c-font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--c-text-secondary)" }}>
                      {highlight(m.preview.trimStart(), query, caseSensitive)}
                    </span>
                  </button>
                ))}
            </div>
          );
        })}
        {results != null && results.length === 0 && !busy && (
          <div style={{ padding: "16px 12px", fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)", textAlign: "center" }}>No results</div>
        )}
      </div>
    </div>
  );
}
