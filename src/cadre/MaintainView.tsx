/**
 * MaintainView — the Maintenance/Support cockpit for an existing app.
 *
 * Shown (instead of the Build orchestrator / PlanningStudio) when a project is
 * opened that carries no greenfield plan artifacts — see `detectProjectMode`
 * and the routing in CadreApp. Three columns:
 *
 *   TaskQueue  |  Fleet (AgentOrgChart)  |  Terminal (TerminalPanel)
 *
 * The middle and right columns are the exact same components the Build flow
 * uses — reused, not reimplemented.
 */

import { Wrench } from "lucide-react";
import { useBmadStore } from "../stores/bmadStore";
import { TaskQueue } from "./maintain/TaskQueue";
import { AgentOrgChart } from "./AgentOrgChart";
import { TerminalPanel } from "./TerminalPanel";

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

const columnBorder = "1px solid var(--c-border)";

export function MaintainView() {
  const projectRoot = useBmadStore((s) => s.projectRoot);
  const repo = projectRoot ? basename(projectRoot) : "";

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0, background: "var(--c-bg)" }}>
      {/* ── Header — "Maintain · <repo>" ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--c-space-2)",
          padding: "var(--c-space-2) var(--c-space-4)",
          borderBottom: columnBorder,
          background: "var(--c-surface-1)",
          flexShrink: 0,
        }}
      >
        <Wrench size={14} strokeWidth={2} style={{ color: "var(--c-accent)" }} />
        <span style={{ fontSize: "var(--c-fs-sm)", fontWeight: 650, color: "var(--c-text)", letterSpacing: "0.01em" }}>
          Maintain
        </span>
        <span style={{ fontSize: "var(--c-fs-sm)", color: "var(--c-text-faint)" }}>·</span>
        <span
          className="cadre-label-mono"
          style={{
            fontSize: "var(--c-fs-xs)",
            fontWeight: 600,
            color: "var(--c-text-secondary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={projectRoot ?? undefined}
        >
          {repo}
        </span>
      </div>

      {/* ── Three columns ── */}
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {/* Column 1 — task intake + queue */}
        <div style={{ width: 340, flexShrink: 0, minWidth: 0, borderRight: columnBorder }}>
          <TaskQueue />
        </div>

        {/* Column 2 — the live fleet org-chart */}
        <div style={{ flex: 1, minWidth: 0, borderRight: columnBorder }}>
          <AgentOrgChart />
        </div>

        {/* Column 3 — a real terminal rooted at the project */}
        <div style={{ width: 420, flexShrink: 0, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {projectRoot ? (
            <TerminalPanel cwd={projectRoot} />
          ) : (
            <div
              style={{
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--c-text-muted)",
                fontSize: "var(--c-fs-xs)",
              }}
            >
              No project open
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
