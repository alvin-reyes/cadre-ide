/**
 * FleetTab — the live fleet for one batch of maintenance subagents. A responsive
 * grid of SubagentCards you can resize (S/M/L) and drag to reorder. Maximizing a
 * card HIDES the rest (display:none) rather than unmounting them, so every
 * subagent's interactive terminal keeps running.
 */
import { useRef, useState } from "react";
import { SubagentCard } from "./SubagentCard";
import type { FleetBatch } from "../../lib/maintain/tasks";

type FleetSize = "s" | "m" | "l";
const SIZES: Record<FleetSize, { min: number; minHeight: number; font: number; label: string }> = {
  s: { min: 320, minHeight: 220, font: 13, label: "S" },
  m: { min: 440, minHeight: 300, font: 15, label: "M" },
  l: { min: 640, minHeight: 400, font: 18, label: "L" },
};

const SIZE_KEY = "cadre-fleet-size";
function loadSize(): FleetSize {
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(SIZE_KEY) : null;
    if (v === "s" || v === "m" || v === "l") return v;
  } catch { /* unavailable */ }
  return "m";
}
function saveSize(v: FleetSize) {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(SIZE_KEY, v); } catch { /* unavailable */ }
}

export function FleetTab({
  batch,
  projectDir,
  onCloseSubagent,
  onExitSubagent,
  onReorderSubagent,
}: {
  batch: FleetBatch;
  projectDir: string;
  onCloseSubagent: (taskId: string) => void;
  onExitSubagent: (taskId: string) => void;
  onReorderSubagent: (fromTaskId: string, toTaskId: string) => void;
}) {
  const [maxId, setMaxId] = useState<string | null>(null);
  const [size, setSize] = useState<FleetSize>(loadSize);
  const dragId = useRef<string | null>(null);
  const toggle = (id: string) => setMaxId((cur) => (cur === id ? null : id));
  const s = SIZES[size];

  const pickSize = (v: FleetSize) => { setSize(v); saveSize(v); };

  return (
    <div style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* Toolbar: grid size control */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px var(--c-space-4)", borderBottom: "1px solid var(--c-border)", flexShrink: 0 }}>
        <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>Grid size</span>
        <div style={{ display: "inline-flex", border: "1px solid var(--c-border)", borderRadius: "var(--c-radius-sm)", overflow: "hidden" }}>
          {(Object.keys(SIZES) as FleetSize[]).map((k) => (
            <button
              key={k}
              onClick={() => pickSize(k)}
              aria-pressed={size === k}
              title={`${SIZES[k].label} cards`}
              className="cadre-hover"
              style={{ width: 26, height: 22, fontSize: "var(--c-fs-xs)", fontWeight: 600, border: "none", background: size === k ? "var(--c-surface-3)" : "transparent", color: size === k ? "var(--c-text)" : "var(--c-text-muted)", cursor: "pointer" }}
            >
              {SIZES[k].label}
            </button>
          ))}
        </div>
        <span style={{ marginLeft: "auto", fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>
          Drag a card's header to reorder
        </span>
      </div>

      {/* Grid */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "var(--c-space-4)" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: maxId ? "1fr" : `repeat(auto-fill, minmax(${s.min}px, 1fr))`,
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
                onDragOver={(e) => { if (dragId.current && !maxId) e.preventDefault(); }}
                onDrop={() => {
                  if (dragId.current && dragId.current !== run.taskId) onReorderSubagent(dragId.current, run.taskId);
                  dragId.current = null;
                }}
                style={{ display: hidden ? "none" : "flex", minHeight: maxId ? 0 : s.minHeight, height: maxId ? "100%" : undefined }}
              >
                <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex" }}>
                  <SubagentCard
                    run={run}
                    projectDir={projectDir}
                    maximized={maxId === run.taskId}
                    termFontSize={s.font}
                    draggable={!maxId}
                    onToggleMax={() => toggle(run.taskId)}
                    onClose={() => { if (maxId === run.taskId) setMaxId(null); onCloseSubagent(run.taskId); }}
                    onExit={() => onExitSubagent(run.taskId)}
                    onDragStart={() => { dragId.current = run.taskId; }}
                    onDragEnd={() => { dragId.current = null; }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
