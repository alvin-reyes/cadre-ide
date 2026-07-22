import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { TerminalPanel } from "./TerminalPanel";

/**
 * Multiple terminal sessions in one panel. Every session stays mounted (only the
 * active one is visible) so its PTY, scrollback, and running processes survive tab
 * switches — closing a tab is what kills its shell.
 */

let seq = 0;

export function TerminalTabs({ cwd }: { cwd: string }) {
  const [ids, setIds] = useState<number[]>(() => [++seq]);
  const [active, setActive] = useState<number>(ids[0]);

  function addTab() {
    const id = ++seq;
    setIds((a) => [...a, id]);
    setActive(id);
  }

  // Ctrl+T (dispatched from CadreApp) opens a new session. The setters are stable,
  // so registering once is enough.
  useEffect(() => {
    const onNew = () => {
      const id = ++seq;
      setIds((a) => [...a, id]);
      setActive(id);
    };
    window.addEventListener("cadre:new-terminal", onNew);
    return () => window.removeEventListener("cadre:new-terminal", onNew);
  }, []);

  function closeTab(id: number) {
    setIds((a) => {
      const idx = a.indexOf(id);
      const next = a.filter((x) => x !== id);
      if (next.length === 0) {
        const nid = ++seq;
        setActive(nid);
        return [nid];
      }
      if (active === id) setActive(next[Math.min(idx, next.length - 1)]);
      return next;
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Session tab strip */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          padding: "3px 6px",
          borderBottom: "1px solid var(--c-border)",
          background: "var(--c-surface-1)",
          flexShrink: 0,
          overflowX: "auto",
        }}
      >
        {ids.map((id, i) => {
          const on = active === id;
          return (
            <div
              key={id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                borderRadius: "var(--c-radius-sm)",
                background: on ? "var(--c-surface-3)" : "transparent",
                flexShrink: 0,
              }}
            >
              <button
                onClick={() => setActive(id)}
                aria-pressed={on}
                aria-label={`Terminal ${i + 1}`}
                className="cadre-hover"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  height: 26,
                  fontSize: "var(--c-fs-xs)",
                  fontWeight: 550 as const,
                  padding: "0 4px 0 10px",
                  borderRadius: "var(--c-radius-sm) 0 0 var(--c-radius-sm)",
                  background: "transparent",
                  border: "none",
                  color: on ? "var(--c-text)" : "var(--c-text-muted)",
                  cursor: "pointer",
                }}
              >
                Terminal {i + 1}
              </button>
              <button
                onClick={() => closeTab(id)}
                aria-label={`Close terminal ${i + 1}`}
                title="Close terminal"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 22,
                  height: 26,
                  borderRadius: "0 var(--c-radius-sm) var(--c-radius-sm) 0",
                  background: "transparent",
                  border: "none",
                  color: on ? "var(--c-text-secondary)" : "var(--c-text-faint)",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                <X size={11} strokeWidth={2.5} />
              </button>
            </div>
          );
        })}
        <button
          onClick={addTab}
          title="New terminal (Ctrl+T)"
          aria-label="New terminal"
          className="cadre-hover"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 26,
            height: 26,
            borderRadius: "var(--c-radius-sm)",
            background: "transparent",
            border: "1px solid var(--c-border)",
            color: "var(--c-text-secondary)",
            cursor: "pointer",
            flexShrink: 0,
            marginLeft: 2,
          }}
        >
          <Plus size={13} strokeWidth={2.5} />
        </button>
      </div>

      {/* Sessions — all mounted, only the active one shown. */}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {ids.map((id) => (
          <div
            key={id}
            style={{
              position: "absolute",
              inset: 0,
              display: active === id ? "block" : "none",
            }}
          >
            <TerminalPanel cwd={cwd} />
          </div>
        ))}
      </div>
    </div>
  );
}
