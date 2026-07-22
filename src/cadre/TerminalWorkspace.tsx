import { SquareTerminal, X, Maximize2, Minimize2 } from "lucide-react";
import { TerminalTabs } from "./TerminalTabs";

/**
 * The Terminal chrome: a header (project cwd, maximize, close) over the multi-
 * session tab strip. Used inside the bottom TerminalDrawer; the maximize toggle is
 * optional and only shown when the host wires it.
 */
export function TerminalWorkspace({
  root,
  onClose,
  maximized,
  onToggleMaximize,
}: {
  root: string;
  onClose: () => void;
  maximized?: boolean;
  onToggleMaximize?: () => void;
}) {
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
        <span style={{ fontSize: "var(--c-fs-xs)", fontFamily: "var(--c-font-mono)", color: "var(--c-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, maxWidth: 320 }}>
          {root}
        </span>
        <div style={{ flex: 1 }} />
        {onToggleMaximize && (
          <button
            onClick={onToggleMaximize}
            title={maximized ? "Restore panel" : "Maximize panel"}
            aria-label={maximized ? "Restore terminal panel" : "Maximize terminal panel"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 24,
              height: 22,
              borderRadius: "var(--c-radius-sm)",
              background: "transparent",
              border: "1px solid var(--c-border)",
              color: "var(--c-text-secondary)",
              cursor: "pointer",
            }}
          >
            {maximized ? <Minimize2 size={13} strokeWidth={2} /> : <Maximize2 size={13} strokeWidth={2} />}
          </button>
        )}
        <button
          onClick={onClose}
          title="Close terminal (Ctrl+`)"
          aria-label="Close terminal"
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
