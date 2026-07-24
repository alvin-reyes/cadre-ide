import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2, ScrollText } from "lucide-react";
import { Modal } from "./components/Modal";
import { useAiLog } from "../stores/aiLogStore";

/**
 * The global AI activity log — every fleet agent's output, review, sharding, and
 * brownfield analysis in one always-reachable place, so failures are diagnosable
 * without hunting per-story. Filter by source; auto-scrolls while at the bottom.
 */
function ts(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function AiLog({ onClose }: { onClose: () => void }) {
  const entries = useAiLog((s) => s.entries);
  const clear = useAiLog((s) => s.clear);
  const [filter, setFilter] = useState<string>("all");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  const sources = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) set.add(e.source);
    return ["all", ...Array.from(set).sort()];
  }, [entries]);

  const shown = entries
    .filter((e) => filter === "all" || e.source === filter)
    .filter((e) => !errorsOnly || e.level === "error");

  // Switching source or errors-only resets the view to the tail.
  useEffect(() => {
    atBottom.current = true;
  }, [filter, errorsOnly]);

  // Auto-scroll to the tail while the user is already at the bottom (keyed on the
  // latest entry id, not just length, so it fires on genuine new lines).
  const tailId = shown.length ? shown[shown.length - 1].id : 0;
  useEffect(() => {
    const el = bodyRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [tailId, filter]);

  function onScroll() {
    const el = bodyRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  return (
    <Modal
      label="AI activity log"
      width={760}
      maxHeightVh={84}
      onClose={onClose}
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <ScrollText size={16} strokeWidth={2} style={{ color: "var(--c-accent)" }} />
          <span style={{ fontSize: "var(--c-fs-lg)", fontWeight: 600 as const, color: "var(--c-text)" }}>AI activity</span>
          <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)" }}>{entries.length} lines</span>
        </span>
      }
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px var(--c-space-4)", borderBottom: "1px solid var(--c-border)" }}>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter by source"
          style={{ background: "var(--c-surface-2)", border: "1px solid var(--c-border-strong)", borderRadius: "var(--c-radius-sm)", color: "var(--c-text)", fontSize: "var(--c-fs-xs)", padding: "4px 8px" }}
        >
          {sources.map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "All sources" : s}
            </option>
          ))}
        </select>
        <label
          style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)", cursor: "pointer", userSelect: "none" }}
        >
          <input
            type="checkbox"
            checked={errorsOnly}
            onChange={(e) => setErrorsOnly(e.target.checked)}
            aria-label="Show errors only"
            style={{ accentColor: "var(--c-danger)", cursor: "pointer" }}
          />
          Errors only
        </label>
        <div style={{ flex: 1 }} />
        <button
          onClick={clear}
          title="Clear the log"
          aria-label="Clear the log"
          className="cadre-hover"
          style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "var(--c-fs-xs)", padding: "4px 10px", borderRadius: "var(--c-radius-sm)", background: "transparent", border: "1px solid var(--c-border)", color: "var(--c-text-muted)", cursor: "pointer" }}
        >
          <Trash2 size={12} strokeWidth={2} />
          Clear
        </button>
      </div>

      <div
        ref={bodyRef}
        onScroll={onScroll}
        style={{
          height: "56vh",
          overflow: "auto",
          background: "var(--c-code-bg)",
          padding: "var(--c-space-3)",
          fontFamily: "var(--c-font-mono)",
          fontSize: "var(--c-fs-xs)",
          lineHeight: 1.55,
        }}
      >
        {shown.length === 0 ? (
          <div style={{ color: "var(--c-text-faint)" }}>No AI activity yet. Dispatch a story, run a review, or analyze a project.</div>
        ) : (
          shown.map((e) => (
            <div key={e.id} style={{ display: "flex", gap: 8, whiteSpace: "pre-wrap", wordBreak: "break-word", color: e.level === "error" ? "var(--c-danger)" : "var(--c-text-secondary)" }}>
              <span style={{ color: "var(--c-text-faint)", flexShrink: 0 }}>{ts(e.ts)}</span>
              <span style={{ color: "var(--c-accent)", flexShrink: 0 }}>{e.source}</span>
              <span style={{ flex: 1 }}>{e.text.replace(/\n$/, "")}</span>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
