/**
 * MaintainView — the Maintenance/Support cockpit for an existing app.
 *
 * Shown (instead of the Build orchestrator / PlanningStudio) when the user
 * chooses to maintain an opened project rather than build features in it.
 *
 * Two panes:
 *  - LEFT: the TaskQueue — describe a change and it dispatches a real agent on an
 *    isolated `task/<id>` worktree (queued → running), listed by status.
 *  - RIGHT: Claude Code CLI terminals rooted at the project. The first terminal
 *    preloads `claude` (auto-loads CLAUDE.md + the repo) so the maintainer lands in
 *    a ready, project-aware session; more open via tabs / split / Ctrl+T.
 *
 * No plan → shard → dispatch: maintenance work is ad-hoc, not plan-gated.
 */

import { Wrench } from "lucide-react";
import { useBmadStore } from "../stores/bmadStore";
import { TerminalTabs } from "./TerminalTabs";
import { TaskQueue } from "./maintain/TaskQueue";

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function MaintainView() {
  const projectRoot = useBmadStore((s) => s.projectRoot);
  // Routing only mounts this when a project is open; guard anyway.
  if (!projectRoot) return null;
  const repo = basename(projectRoot);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0, background: "var(--c-bg)" }}>
      {/* ── Header — "Maintain · <repo>" ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--c-space-2)",
          padding: "var(--c-space-2) var(--c-space-4)",
          borderBottom: "1px solid var(--c-border)",
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
          title={projectRoot}
        >
          {repo}
        </span>
        <span style={{ marginLeft: "auto", fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>
          Dispatch tasks on the left · Claude terminal on the right
        </span>
      </div>

      {/* ── Two panes: Task queue (left) · terminals (right) ── */}
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {/* Task queue — fixed rail; describe a change → agent on a task/<id> worktree. */}
        <div
          style={{
            width: 340,
            flexShrink: 0,
            minHeight: 0,
            borderRight: "1px solid var(--c-border)",
            background: "var(--c-surface-1)",
          }}
        >
          <TaskQueue />
        </div>

        {/* Project terminals — first tab preloads claude; + / split for more. */}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <TerminalTabs key={projectRoot} cwd={projectRoot} startupCommand="claude" surfaceId={`maintain:${projectRoot}`} />
        </div>
      </div>
    </div>
  );
}
