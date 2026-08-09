/**
 * ThoughtsDock — a persistent "thoughts" composer docked under the main terminal
 * (Better-Terminal style). Jot thoughts / assemble a prompt here; Send (or ⌘/Ctrl+
 * Enter) types it into the active terminal pane and presses Enter. Text persists
 * per project, and the dock collapses to a slim bar.
 */
import { useState, type KeyboardEvent } from "react";
import { Lightbulb, ChevronDown, ChevronUp, CornerDownLeft } from "lucide-react";
import { sendToActive } from "../../lib/terminalBus";
import { toast } from "../../stores/toastStore";

function key(projectRoot: string): string {
  return `cadre-thoughts:${projectRoot}`;
}
function load(projectRoot: string): string {
  try { return localStorage.getItem(key(projectRoot)) ?? ""; } catch { return ""; }
}

export function ThoughtsDock({ surfaceId, projectRoot }: { surfaceId: string; projectRoot: string }) {
  const [text, setText] = useState(() => load(projectRoot));
  const [collapsed, setCollapsed] = useState(false);
  const [sending, setSending] = useState(false);

  const update = (v: string) => {
    setText(v);
    try { localStorage.setItem(key(projectRoot), v); } catch { /* unavailable */ }
  };

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      const ok = await sendToActive(surfaceId, t + "\n");
      if (!ok) toast("No active terminal to send to — click into a terminal first", "error");
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // ⌘/Ctrl+Enter sends; plain Enter keeps a newline (it's a scratchpad).
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div style={{ flexShrink: 0, borderTop: "1px solid var(--c-border)", background: "var(--c-surface-1)" }}>
      {/* Header / collapse bar */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="cadre-hover"
        style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "5px var(--c-space-4)", background: "transparent", border: "none", cursor: "pointer", color: "var(--c-text-secondary)" }}
      >
        <Lightbulb size={13} strokeWidth={2} style={{ color: "var(--c-accent)" }} />
        <span style={{ fontSize: "var(--c-fs-sm)", fontWeight: 600, color: "var(--c-text)" }}>Thoughts</span>
        <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>scratchpad → active terminal</span>
        <span style={{ marginLeft: "auto", display: "inline-flex", color: "var(--c-text-muted)" }}>
          {collapsed ? <ChevronUp size={14} strokeWidth={2} /> : <ChevronDown size={14} strokeWidth={2} />}
        </span>
      </button>

      {!collapsed && (
        <div style={{ padding: "0 var(--c-space-4) var(--c-space-3)", display: "flex", flexDirection: "column", gap: "var(--c-space-2)" }}>
          <textarea
            value={text}
            onChange={(e) => update(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Think out loud, draft a prompt, keep notes… ⌘/Ctrl+Enter sends it to the terminal."
            rows={3}
            style={{
              width: "100%",
              resize: "vertical",
              minHeight: 56,
              border: "1px solid var(--c-border-strong)",
              borderRadius: "var(--c-radius)",
              background: "var(--c-surface-2)",
              color: "var(--c-text)",
              fontFamily: "inherit",
              fontSize: "var(--c-fs-base)",
              lineHeight: 1.5,
              padding: "var(--c-space-2) var(--c-space-3)",
              outline: "none",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--c-space-2)" }}>
            <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>Persists per project</span>
            <button
              onClick={() => void send()}
              disabled={!text.trim() || sending}
              className={text.trim() && !sending ? "cadre-btn-primary" : undefined}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--c-fs-sm)", fontWeight: 550, padding: "5px 12px", borderRadius: "var(--c-radius)", border: "none", background: text.trim() && !sending ? undefined : "var(--c-surface-3)", color: text.trim() && !sending ? undefined : "var(--c-text-muted)", cursor: text.trim() && !sending ? "pointer" : "default" }}
            >
              <CornerDownLeft size={13} strokeWidth={2.5} /> Send to terminal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
