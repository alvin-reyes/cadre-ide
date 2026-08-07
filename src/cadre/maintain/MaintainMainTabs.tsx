/**
 * MaintainMainTabs — the cockpit's main area. A persistent Terminal tab (the
 * project Claude session) plus one Fleet tab per launched batch. The IntakeRail's
 * "Run all" opens and focuses the new Fleet tab. All tabs stay mounted (Terminal
 * PTYs must survive tab switches); only the active one is shown.
 */
import { useEffect, useState } from "react";
import { Terminal as TerminalIcon, Network, X } from "lucide-react";
import { TerminalTabs } from "../TerminalTabs";
import { FleetTab } from "./FleetTab";
import { IntakeRail } from "./IntakeRail";
import { useCadre } from "../useCadre";

export function MaintainMainTabs({ projectRoot }: { projectRoot: string }) {
  const batches = useCadre((s) => s.batches);
  const closeBatch = useCadre((s) => s.closeBatch);
  const closeSubagent = useCadre((s) => s.closeSubagent);
  const [active, setActive] = useState<string>("terminal");

  // If the active Fleet tab's batch disappears (e.g. project switch), fall back to Terminal.
  useEffect(() => {
    if (active !== "terminal" && !batches.some((b) => b.id === active)) setActive("terminal");
  }, [active, batches]);

  const fmt = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  const hidden = (on: boolean) => ({ position: "absolute" as const, inset: 0, display: on ? "block" : "none" });

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      {/* Left rail */}
      <div style={{ width: 320, flexShrink: 0, minHeight: 0, borderRight: "1px solid var(--c-border)", background: "var(--c-surface-1)" }}>
        <IntakeRail onBatchLaunched={(id) => setActive(id)} />
      </div>

      {/* Main tabbed area */}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 2, padding: "3px 6px", borderBottom: "1px solid var(--c-border)", background: "var(--c-surface-1)", flexShrink: 0, overflowX: "auto" }}>
          <TabButton icon={<TerminalIcon size={12} strokeWidth={2} />} label="Terminal" on={active === "terminal"} onClick={() => setActive("terminal")} />
          {batches.map((b) => (
            <TabButton
              key={b.id}
              icon={<Network size={12} strokeWidth={2} />}
              label={`Fleet · ${fmt(b.createdAt)}`}
              on={active === b.id}
              onClick={() => setActive(b.id)}
              onClose={() => void closeBatch(b.id)}
            />
          ))}
        </div>
        <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
          <div style={hidden(active === "terminal")}>
            <TerminalTabs key={projectRoot} cwd={projectRoot} startupCommand="claude" surfaceId={`maintain:${projectRoot}`} />
          </div>
          {batches.map((b) => (
            <div key={b.id} style={hidden(active === b.id)}>
              <FleetTab batch={b} onCloseSubagent={(taskId) => void closeSubagent(b.id, taskId)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TabButton({ icon, label, on, onClick, onClose }: { icon: React.ReactNode; label: string; on: boolean; onClick: () => void; onClose?: () => void }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", borderRadius: "var(--c-radius-sm)", background: on ? "var(--c-surface-3)" : "transparent", flexShrink: 0 }}>
      <button onClick={onClick} aria-pressed={on} className="cadre-hover" style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 26, fontSize: "var(--c-fs-xs)", fontWeight: 550, padding: onClose ? "0 4px 0 10px" : "0 10px", borderRadius: onClose ? "var(--c-radius-sm) 0 0 var(--c-radius-sm)" : "var(--c-radius-sm)", background: "transparent", border: "none", color: on ? "var(--c-text)" : "var(--c-text-muted)", cursor: "pointer" }}>
        {icon}{label}
      </button>
      {onClose && (
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          title="Close Fleet tab (stops running agents)"
          aria-label="Close Fleet tab"
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 26, borderRadius: "0 var(--c-radius-sm) var(--c-radius-sm) 0", background: "transparent", border: "none", color: on ? "var(--c-text-secondary)" : "var(--c-text-faint)", cursor: "pointer", padding: 0 }}
        >
          <X size={11} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}
