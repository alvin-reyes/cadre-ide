/**
 * FleetTab — the live fleet for one batch of maintenance subagents. A responsive
 * grid of SubagentCards; maximizing a card hides the rest so the user can watch
 * that one agent's progress full-tab. Maximize state is local to this tab.
 */
import { useState } from "react";
import { SubagentCard } from "./SubagentCard";
import type { FleetBatch } from "../../lib/maintain/tasks";

export function FleetTab({ batch, onCloseSubagent }: { batch: FleetBatch; onCloseSubagent: (taskId: string) => void }) {
  const [maxId, setMaxId] = useState<string | null>(null);
  const runs = maxId ? batch.subagents.filter((s) => s.taskId === maxId) : batch.subagents;
  const toggle = (id: string) => setMaxId((cur) => (cur === id ? null : id));

  return (
    <div style={{ height: "100%", minHeight: 0, overflow: "auto", padding: "var(--c-space-4)" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: maxId ? "1fr" : "repeat(auto-fill, minmax(340px, 1fr))",
          gap: "var(--c-space-4)",
          minHeight: 0,
          height: maxId ? "100%" : undefined,
        }}
      >
        {runs.map((run) => (
          <div key={run.taskId} style={{ minHeight: maxId ? 0 : 220, height: maxId ? "100%" : undefined, display: "flex" }}>
            <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex" }}>
              <SubagentCard
                run={run}
                maximized={maxId === run.taskId}
                onToggleMax={() => toggle(run.taskId)}
                onClose={() => { if (maxId === run.taskId) setMaxId(null); onCloseSubagent(run.taskId); }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
