/**
 * FleetTab — the live fleet for one batch of maintenance subagents. A responsive
 * grid of SubagentCards; maximizing a card HIDES the rest (display:none) rather
 * than unmounting them, so every subagent's interactive terminal keeps running.
 * Maximize state is local to this tab.
 */
import { useState } from "react";
import { SubagentCard } from "./SubagentCard";
import type { FleetBatch } from "../../lib/maintain/tasks";

export function FleetTab({
  batch,
  onCloseSubagent,
  onExitSubagent,
}: {
  batch: FleetBatch;
  onCloseSubagent: (taskId: string) => void;
  onExitSubagent: (taskId: string) => void;
}) {
  const [maxId, setMaxId] = useState<string | null>(null);
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
        {batch.subagents.map((run) => {
          const hidden = maxId != null && maxId !== run.taskId;
          return (
            <div
              key={run.taskId}
              style={{ display: hidden ? "none" : "flex", minHeight: maxId ? 0 : 260, height: maxId ? "100%" : undefined }}
            >
              <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex" }}>
                <SubagentCard
                  run={run}
                  maximized={maxId === run.taskId}
                  onToggleMax={() => toggle(run.taskId)}
                  onClose={() => { if (maxId === run.taskId) setMaxId(null); onCloseSubagent(run.taskId); }}
                  onExit={() => onExitSubagent(run.taskId)}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
