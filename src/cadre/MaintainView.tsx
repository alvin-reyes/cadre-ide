/**
 * MaintainView — the Maintenance/Support cockpit for an existing app. Stage a
 * list of tasks in the left rail (prompts + composer), then Run all to launch
 * them as a live fleet of isolated-worktree subagents in a new Fleet tab.
 */
import { Wrench } from "lucide-react";
import { useBmadStore } from "../stores/bmadStore";
import { MaintainMainTabs } from "./maintain/MaintainMainTabs";

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function MaintainView() {
  const projectRoot = useBmadStore((s) => s.projectRoot);
  if (!projectRoot) return null;
  const repo = basename(projectRoot);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0, background: "var(--c-bg)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--c-space-2)", padding: "var(--c-space-2) var(--c-space-4)", borderBottom: "1px solid var(--c-border)", background: "var(--c-surface-1)", flexShrink: 0 }}>
        <Wrench size={14} strokeWidth={2} style={{ color: "var(--c-accent)" }} />
        <span style={{ fontSize: "var(--c-fs-sm)", fontWeight: 650, color: "var(--c-text)", letterSpacing: "0.01em" }}>Maintain</span>
        <span style={{ fontSize: "var(--c-fs-sm)", color: "var(--c-text-faint)" }}>·</span>
        <span className="cadre-label-mono" style={{ fontSize: "var(--c-fs-xs)", fontWeight: 600, color: "var(--c-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={projectRoot}>{repo}</span>
        <span style={{ marginLeft: "auto", fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>Stage tasks on the left · Run all to launch a fleet</span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <MaintainMainTabs projectRoot={projectRoot} />
      </div>
    </div>
  );
}
