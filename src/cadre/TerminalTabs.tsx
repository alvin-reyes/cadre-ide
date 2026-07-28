import { useEffect, useState } from "react";
import { Plus, X, SplitSquareHorizontal } from "lucide-react";
import { TerminalPanel } from "./TerminalPanel";

/**
 * Terminal sessions in one panel. Each TAB can be SPLIT into several side-by-side
 * panes (each its own shell). Every tab + pane stays mounted (only the active tab is
 * visible) so PTYs, scrollback, and running processes survive tab switches — closing a
 * pane/tab is what kills its shell.
 */

let seq = 0;
interface Tab {
  id: number;
  panes: number[];
}

export function TerminalTabs({ cwd, startupCommand }: { cwd: string; startupCommand?: string }) {
  const [tabs, setTabs] = useState<Tab[]>(() => [{ id: ++seq, panes: [++seq] }]);
  const [active, setActive] = useState<number>(tabs[0].id);
  // The very first pane preloads `startupCommand` (e.g. `claude` in Maintenance);
  // panes spawned afterward are plain shells. Captured once so tab churn can't move it.
  const [initialPaneId] = useState<number>(() => tabs[0].panes[0]);

  function addTab() {
    const id = ++seq;
    setTabs((t) => [...t, { id, panes: [++seq] }]);
    setActive(id);
  }

  function removeTab(list: Tab[], tabId: number): Tab[] {
    const idx = list.findIndex((x) => x.id === tabId);
    const next = list.filter((x) => x.id !== tabId);
    if (next.length === 0) {
      const nid = ++seq;
      setActive(nid);
      return [{ id: nid, panes: [++seq] }];
    }
    if (active === tabId) setActive(next[Math.min(idx, next.length - 1)].id);
    return next;
  }

  function closeTab(tabId: number) {
    setTabs((t) => removeTab(t, tabId));
  }

  // Split the active tab into another side-by-side pane.
  function splitActive() {
    setTabs((t) => t.map((x) => (x.id === active ? { ...x, panes: [...x.panes, ++seq] } : x)));
  }

  function closePane(tabId: number, paneId: number) {
    setTabs((t) => {
      const tab = t.find((x) => x.id === tabId);
      if (!tab) return t;
      const panes = tab.panes.filter((p) => p !== paneId);
      if (panes.length === 0) return removeTab(t, tabId); // closed the last pane → close the tab
      return t.map((x) => (x.id === tabId ? { ...x, panes } : x));
    });
  }

  // Ctrl+T (dispatched from CadreApp) opens a new tab. Setters are stable.
  useEffect(() => {
    const onNew = () => {
      const id = ++seq;
      setTabs((t) => [...t, { id, panes: [++seq] }]);
      setActive(id);
    };
    window.addEventListener("cadre:new-terminal", onNew);
    return () => window.removeEventListener("cadre:new-terminal", onNew);
  }, []);

  const railBtn = {
    display: "inline-flex" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    width: 26,
    height: 26,
    borderRadius: "var(--c-radius-sm)",
    background: "transparent",
    border: "1px solid var(--c-border)",
    color: "var(--c-text-secondary)",
    cursor: "pointer",
    flexShrink: 0,
    marginLeft: 2,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Session tab strip */}
      <div style={{ display: "flex", alignItems: "center", gap: 2, padding: "3px 6px", borderBottom: "1px solid var(--c-border)", background: "var(--c-surface-1)", flexShrink: 0, overflowX: "auto" }}>
        {tabs.map((tab, i) => {
          const on = active === tab.id;
          return (
            <div key={tab.id} style={{ display: "inline-flex", alignItems: "center", borderRadius: "var(--c-radius-sm)", background: on ? "var(--c-surface-3)" : "transparent", flexShrink: 0 }}>
              <button
                onClick={() => setActive(tab.id)}
                aria-pressed={on}
                aria-label={`Terminal ${i + 1}`}
                className="cadre-hover"
                style={{ display: "inline-flex", alignItems: "center", height: 26, fontSize: "var(--c-fs-xs)", fontWeight: 550 as const, padding: "0 4px 0 10px", borderRadius: "var(--c-radius-sm) 0 0 var(--c-radius-sm)", background: "transparent", border: "none", color: on ? "var(--c-text)" : "var(--c-text-muted)", cursor: "pointer" }}
              >
                Terminal {i + 1}
                {tab.panes.length > 1 && <span style={{ marginLeft: 4, color: "var(--c-text-faint)" }}>·{tab.panes.length}</span>}
              </button>
              <button
                onClick={() => closeTab(tab.id)}
                aria-label={`Close terminal ${i + 1}`}
                title="Close terminal"
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 26, borderRadius: "0 var(--c-radius-sm) var(--c-radius-sm) 0", background: "transparent", border: "none", color: on ? "var(--c-text-secondary)" : "var(--c-text-faint)", cursor: "pointer", padding: 0 }}
              >
                <X size={11} strokeWidth={2.5} />
              </button>
            </div>
          );
        })}
        <button onClick={splitActive} title="Split terminal (side by side)" aria-label="Split terminal" className="cadre-hover" style={railBtn}>
          <SplitSquareHorizontal size={13} strokeWidth={2} />
        </button>
        <button onClick={addTab} title="New terminal (Ctrl+T)" aria-label="New terminal" className="cadre-hover" style={railBtn}>
          <Plus size={13} strokeWidth={2.5} />
        </button>
      </div>

      {/* Tabs — all mounted, only the active one shown; each tab's panes split side by side. */}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {tabs.map((tab) => (
          <div key={tab.id} style={{ position: "absolute", inset: 0, display: active === tab.id ? "flex" : "none" }}>
            {tab.panes.map((paneId, pi) => (
              <div key={paneId} style={{ flex: 1, minWidth: 0, minHeight: 0, position: "relative", borderLeft: pi > 0 ? "1px solid var(--c-border-strong)" : "none" }}>
                {tab.panes.length > 1 && (
                  <button
                    onClick={() => closePane(tab.id, paneId)}
                    title="Close this pane"
                    aria-label="Close pane"
                    style={{ position: "absolute", top: 3, right: 3, zIndex: 2, display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: "var(--c-radius-sm)", background: "var(--c-surface-2)", border: "1px solid var(--c-border)", color: "var(--c-text-muted)", cursor: "pointer", padding: 0, opacity: 0.85 }}
                  >
                    <X size={10} strokeWidth={2.5} />
                  </button>
                )}
                <TerminalPanel cwd={cwd} startupCommand={paneId === initialPaneId ? startupCommand : undefined} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
