import { SquareTerminal, X } from "lucide-react";
import { TerminalTabs } from "./TerminalTabs";

/**
 * The Terminal as a large, full-area workspace — an alternative to the Plan/Fleet
 * main pane rather than a cramped side panel. Full width and height for real
 * hands-on work (running agents, git, builds), with the multi-session tab strip.
 */
export function TerminalWorkspace({ root, onClose }: { root: string; onClose: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: "var(--c-bg)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px var(--c-space-4)",
          borderBottom: "1px solid var(--c-border)",
          background: "var(--c-surface-1)",
          flexShrink: 0,
        }}
      >
        <SquareTerminal size={15} strokeWidth={2} style={{ color: "var(--c-accent)" }} />
        <span style={{ fontSize: "var(--c-fs-sm)", fontWeight: 600 as const, color: "var(--c-text)" }}>Terminal</span>
        <span style={{ fontSize: "var(--c-fs-xs)", fontFamily: "var(--c-font-mono)", color: "var(--c-text-faint)" }}>
          {root}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={onClose}
          title="Close terminal (Esc)"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: "var(--c-fs-xs)",
            fontWeight: 550 as const,
            padding: "3px 10px",
            borderRadius: "var(--c-radius-sm)",
            background: "transparent",
            border: "1px solid var(--c-border)",
            color: "var(--c-text-secondary)",
            cursor: "pointer",
          }}
        >
          <X size={13} strokeWidth={2} />
          Close
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <TerminalTabs cwd={root} />
      </div>
    </div>
  );
}
