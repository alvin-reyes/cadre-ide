import { useState } from "react";
import { TerminalWorkspace } from "./TerminalWorkspace";

/**
 * The terminal as a VS Code–style bottom panel: it spans the main area beneath the
 * Plan/Fleet view and collapses/shows via the dock rail (or Ctrl+`). A drag handle
 * on its top edge resizes the height. Kept mounted while hidden by the parent, so
 * PTY sessions persist.
 */

const MIN_H = 140;
const KEY = "cadre-term-height";

function initialHeight(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    if (v >= MIN_H) return v;
  } catch {
    /* ignore */
  }
  return 300;
}

export function TerminalDrawer({
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
  const [height, setHeight] = useState(initialHeight);

  const clamp = (h: number) => Math.max(MIN_H, Math.min(window.innerHeight * 0.8, h));
  const persist = (h: number) => {
    try {
      localStorage.setItem(KEY, String(h));
    } catch {
      /* ignore */
    }
  };

  function onDown(e: React.MouseEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    let latest = startH; // track the final value so we persist it, not a stale closure
    const onMove = (ev: MouseEvent) => {
      // Dragging up (smaller clientY) grows the panel.
      latest = clamp(startH - (ev.clientY - startY));
      setHeight(latest);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      persist(latest);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function onKey(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHeight((h) => {
        const n = clamp(h + step);
        persist(n);
        return n;
      });
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHeight((h) => {
        const n = clamp(h - step);
        persist(n);
        return n;
      });
    }
  }

  // Maximized: fill the whole area (the host hides the Plan/Fleet view); no fixed
  // height and no resize handle. Docked: the resizable bottom-panel height.
  const containerStyle = maximized
    ? { flex: 1, minHeight: 0, display: "flex" as const, flexDirection: "column" as const }
    : { height, flexShrink: 0, display: "flex" as const, flexDirection: "column" as const, borderTop: "1px solid var(--c-border-strong)" };

  return (
    <div style={containerStyle}>
      {!maximized && (
        <div
          onMouseDown={onDown}
          onKeyDown={onKey}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize terminal panel (arrow keys)"
          aria-valuenow={Math.round(height)}
          aria-valuemin={MIN_H}
          tabIndex={0}
          title="Drag to resize (or focus + arrow keys)"
          className="cadre-divider"
          style={{ height: 8, cursor: "row-resize", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--c-surface-1)" }}
        >
          <div className="cadre-divider-line" style={{ width: 34, height: 2, borderRadius: 2, background: "var(--c-border-strong)" }} />
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        <TerminalWorkspace root={root} onClose={onClose} maximized={maximized} onToggleMaximize={onToggleMaximize} />
      </div>
    </div>
  );
}
