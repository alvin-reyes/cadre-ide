/**
 * MaintainView — the Maintenance/Support cockpit for an existing app.
 *
 * Shown (instead of the Build orchestrator / PlanningStudio) when the user
 * chooses to maintain an opened project rather than build features in it.
 *
 * Deliberately simple: it opens a Claude Code CLI terminal rooted at the project.
 * `claude` auto-loads the project's context (CLAUDE.md and the repo) on start, so
 * the user lands in a ready, project-aware session — the way a maintainer works.
 * No plan → shard → dispatch cycle; you just talk to Claude about the codebase.
 */

import { Wrench } from "lucide-react";
import { useBmadStore } from "../stores/bmadStore";
import { TerminalPanel } from "./TerminalPanel";

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
          Claude is loaded in this project
        </span>
      </div>

      {/* ── The project's Claude terminal ── */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <TerminalPanel cwd={projectRoot} startupCommand="claude" />
      </div>
    </div>
  );
}
