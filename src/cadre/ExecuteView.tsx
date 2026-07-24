import { useState } from "react";
import { KanbanBoard } from "./KanbanBoard";
import { AgentOrgChart } from "./AgentOrgChart";

/**
 * ExecuteView — the combined EXECUTE phase page.
 *
 * Two tabs: Shard (Kanban board of stories) and Fleet (agent org-chart).
 * BOTH tab panels stay mounted at all times — only CSS display is toggled —
 * so live terminal sessions inside AgentOrgChart never reset on tab switch.
 */
export function ExecuteView() {
  const [tab, setTab] = useState<"shard" | "fleet">("shard");

  return (
    <div
      style={{
        position: "relative",
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Tab strip */}
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
        <button
          onClick={() => setTab("shard")}
          aria-pressed={tab === "shard"}
          className="cadre-hover"
          style={{
            display: "inline-flex",
            alignItems: "center",
            height: 26,
            fontSize: "var(--c-fs-xs)",
            fontWeight: 550,
            padding: "0 10px",
            borderRadius: "var(--c-radius-sm)",
            background: tab === "shard" ? "var(--c-surface-3)" : "transparent",
            border: "none",
            color: tab === "shard" ? "var(--c-text)" : "var(--c-text-muted)",
            cursor: "pointer",
          }}
        >
          Shard
        </button>
        <button
          onClick={() => setTab("fleet")}
          aria-pressed={tab === "fleet"}
          className="cadre-hover"
          style={{
            display: "inline-flex",
            alignItems: "center",
            height: 26,
            fontSize: "var(--c-fs-xs)",
            fontWeight: 550,
            padding: "0 10px",
            borderRadius: "var(--c-radius-sm)",
            background: tab === "fleet" ? "var(--c-surface-3)" : "transparent",
            border: "none",
            color: tab === "fleet" ? "var(--c-text)" : "var(--c-text-muted)",
            cursor: "pointer",
          }}
        >
          Fleet
        </button>
      </div>

      {/* Content area — both panels stay mounted, toggled by display */}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <div style={{ position: "absolute", inset: 0, display: tab === "shard" ? "block" : "none" }}>
          <KanbanBoard />
        </div>
        <div style={{ position: "absolute", inset: 0, display: tab === "fleet" ? "block" : "none" }}>
          <AgentOrgChart />
        </div>
      </div>
    </div>
  );
}
