/**
 * SubagentCard — one running maintenance subagent in a Fleet tab. Mirrors the
 * Fleet view's PoolAgentNode: a mono task/branch badge, a status pulse, the
 * status label, and a LiveTerminal tailing this subagent's output. A maximize
 * (⤢) control lets the user expand one card to watch its progress in detail.
 */
import { Maximize2, Minimize2 } from "lucide-react";
import { LiveTerminal } from "../agentShared";
import type { SubagentRun, SubagentStatus } from "../../lib/maintain/tasks";

function statusInfo(status: SubagentStatus): { label: string; color: string; dot: string; live: boolean } {
  switch (status) {
    case "running": return { label: "Running", color: "var(--c-accent)", dot: "cadre-dot cadre-dot-progress", live: true };
    case "done":    return { label: "Done",    color: "var(--c-success)", dot: "cadre-dot cadre-dot-success", live: false };
    case "failed":  return { label: "Failed",  color: "var(--c-warning)", dot: "cadre-dot cadre-dot-warning", live: false };
  }
}

export function SubagentCard({ run, maximized, onToggleMax }: { run: SubagentRun; maximized: boolean; onToggleMax: () => void }) {
  const info = statusInfo(run.status);
  const isRunning = run.status === "running";
  return (
    <div
      className={isRunning ? "cadre-generating" : undefined}
      style={{
        display: "flex", flexDirection: "column", minHeight: 0,
        background: "var(--c-surface-1)",
        border: `1.5px solid ${isRunning ? "color-mix(in srgb, var(--c-accent) 55%, var(--c-border))" : "var(--c-border-strong)"}`,
        borderRadius: "var(--c-radius)", overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "var(--c-space-2) var(--c-space-3)", background: "var(--c-surface-2)", borderBottom: "1px solid var(--c-border)" }}>
        <span className="cadre-label-mono" style={{ fontSize: "9px", fontWeight: 700, color: info.color, background: `color-mix(in srgb, ${info.color} 15%, transparent)`, border: `1px solid color-mix(in srgb, ${info.color} 35%, transparent)`, borderRadius: "var(--c-radius-full)", padding: "1px 7px" }}>
          {run.branch}
        </span>
        {info.live && <span className={info.dot} />}
        <span style={{ fontSize: "var(--c-fs-xs)", color: info.color, fontWeight: 500 }}>{info.label}</span>
        <button
          onClick={onToggleMax}
          title={maximized ? "Restore" : "Maximize"}
          aria-label={maximized ? "Restore subagent" : "Maximize subagent"}
          className="cadre-hover"
          style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: "var(--c-radius-sm)", background: "transparent", border: "1px solid var(--c-border)", color: "var(--c-text-secondary)", cursor: "pointer" }}
        >
          {maximized ? <Minimize2 size={12} strokeWidth={2} /> : <Maximize2 size={12} strokeWidth={2} />}
        </button>
      </div>
      <div style={{ padding: "var(--c-space-2) var(--c-space-3)", flex: 1, minHeight: 0, overflow: "hidden" }}>
        <div style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-secondary)", marginBottom: "var(--c-space-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={run.prompt}>
          {run.prompt}
        </div>
        <LiveTerminal log={run.log} empty={isRunning ? "Waiting for the agent…" : "No output"} />
      </div>
    </div>
  );
}
