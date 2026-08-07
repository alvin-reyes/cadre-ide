/**
 * SubagentCard — one INTERACTIVE maintenance subagent in a Fleet tab. Once its
 * isolated task/<id> worktree is ready, the card hosts a live `claude` terminal
 * (TerminalPanel) rooted in that worktree and seeded with the task prompt, so the
 * user can watch AND steer the agent. Maximize (⤢) expands it; close (✕) drops it
 * (unmounting the terminal, which kills the session).
 */
import { Maximize2, Minimize2, X, Loader2 } from "lucide-react";
import { TerminalPanel } from "../TerminalPanel";
import { subagentCommand } from "../../lib/maintain/runBatch";
import type { SubagentRun, SubagentStatus } from "../../lib/maintain/tasks";

function statusInfo(status: SubagentStatus): { label: string; color: string; dot: string } {
  switch (status) {
    case "preparing": return { label: "Preparing…", color: "var(--c-text-muted)", dot: "cadre-dot cadre-dot-muted" };
    case "running":   return { label: "Live",       color: "var(--c-accent)",     dot: "cadre-dot cadre-dot-progress" };
    case "exited":    return { label: "Exited",     color: "var(--c-text-muted)", dot: "cadre-dot cadre-dot-muted" };
    case "failed":    return { label: "Failed",     color: "var(--c-warning)",    dot: "cadre-dot cadre-dot-warning" };
  }
}

export function SubagentCard({
  run,
  projectDir,
  maximized,
  onToggleMax,
  onClose,
  onExit,
}: {
  run: SubagentRun;
  projectDir: string;
  maximized: boolean;
  onToggleMax: () => void;
  onClose: () => void;
  onExit: () => void;
}) {
  const info = statusInfo(run.status);
  const live = run.status === "running";
  const hasTerminal = run.status === "running" || run.status === "exited";
  return (
    <div
      className={live ? "cadre-generating" : undefined}
      style={{
        display: "flex", flexDirection: "column", minHeight: 0,
        background: "var(--c-surface-1)",
        border: `1.5px solid ${live ? "color-mix(in srgb, var(--c-accent) 55%, var(--c-border))" : "var(--c-border-strong)"}`,
        borderRadius: "var(--c-radius)", overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "var(--c-space-2) var(--c-space-3)", background: "var(--c-surface-2)", borderBottom: "1px solid var(--c-border)" }}>
        <span className="cadre-label-mono" style={{ fontSize: "9px", fontWeight: 700, color: info.color, background: `color-mix(in srgb, ${info.color} 15%, transparent)`, border: `1px solid color-mix(in srgb, ${info.color} 35%, transparent)`, borderRadius: "var(--c-radius-full)", padding: "1px 7px" }}>
          {run.branch}
        </span>
        <span className={info.dot} />
        <span style={{ fontSize: "var(--c-fs-xs)", color: info.color, fontWeight: 500 }}>{info.label}</span>
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 4 }}>
          <button
            onClick={onToggleMax}
            title={maximized ? "Restore" : "Maximize"}
            aria-label={maximized ? "Restore subagent" : "Maximize subagent"}
            className="cadre-hover"
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: "var(--c-radius-sm)", background: "transparent", border: "1px solid var(--c-border)", color: "var(--c-text-secondary)", cursor: "pointer" }}
          >
            {maximized ? <Minimize2 size={12} strokeWidth={2} /> : <Maximize2 size={12} strokeWidth={2} />}
          </button>
          <button
            onClick={onClose}
            title={live ? "Stop & close this subagent" : "Close this subagent"}
            aria-label="Close subagent"
            className="cadre-hover"
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: "var(--c-radius-sm)", background: "transparent", border: "1px solid var(--c-border)", color: "var(--c-text-secondary)", cursor: "pointer" }}
          >
            <X size={12} strokeWidth={2} />
          </button>
        </span>
      </div>

      {/* Prompt line */}
      <div style={{ padding: "5px var(--c-space-3) 0", fontSize: "var(--c-fs-xs)", color: "var(--c-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={run.prompt}>
        {run.prompt}
      </div>

      {/* Body: live terminal once the worktree is ready; placeholders otherwise. */}
      <div style={{ flex: 1, minHeight: 0, padding: "var(--c-space-2) var(--c-space-3) var(--c-space-3)" }}>
        {hasTerminal ? (
          <div style={{ height: "100%", minHeight: 0, borderRadius: "var(--c-radius)", overflow: "hidden", border: "1px solid var(--c-border)" }}>
            <TerminalPanel cwd={run.worktree} startupCommand={subagentCommand(run.prompt, projectDir)} onExit={onExit} />
          </div>
        ) : run.status === "failed" ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", color: "var(--c-warning)", fontSize: "var(--c-fs-sm)", background: "var(--c-code-bg)", borderRadius: "var(--c-radius)", padding: "var(--c-space-4)" }}>
            Couldn't create the worktree for this task.
          </div>
        ) : (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--c-text-muted)", fontSize: "var(--c-fs-sm)", background: "var(--c-code-bg)", borderRadius: "var(--c-radius)", padding: "var(--c-space-4)" }}>
            <Loader2 size={14} strokeWidth={2} className="cadre-spin" /> Preparing worktree…
          </div>
        )}
      </div>
    </div>
  );
}
