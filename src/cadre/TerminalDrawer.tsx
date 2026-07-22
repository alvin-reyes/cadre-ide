import { useRef, useState } from "react";
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
  const drag = useRef<{ startY: number; startH: number } | null>(null);

  function onDown(e: React.MouseEvent) {
    e.preventDefault();
    drag.current = { startY: e.clientY, startH: height };
    const onMove = (ev: MouseEvent) => {
      if (!drag.current) return;
      // Dragging up (smaller clientY) grows the panel.
      const next = drag.current.startH - (ev.clientY - drag.current.startY);
      const max = window.innerHeight * 0.8;
      setHeight(Math.max(MIN_H, Math.min(max, next)));
    };
    const onUp = () => {
      drag.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      try {
        localStorage.setItem(KEY, String(height));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
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
          title="Drag to resize"
          className="cadre-divider"
          style={{ height: 6, cursor: "row-resize", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--c-surface-1)" }}
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
