/**
 * FleetTab — the live fleet for one batch of maintenance subagents as a
 * draggable + resizable TILE GRID (a mini dashboard). Each subagent terminal is a
 * tile you drag (by the header grip) to any grid cell and resize (bottom-right
 * handle); the layout snaps to a column grid. Maximizing a tile fills the tab and
 * hides the rest. All tiles stay mounted so their interactive terminals keep
 * running through moves, resizes, and maximize. Font size is a persisted control.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { SubagentCard } from "./SubagentCard";
import type { FleetBatch } from "../../lib/maintain/tasks";

const COLS = 12;
const ROW_H = 30;      // px per grid row
const GAP = 12;
const DEFAULT_W = 6;   // half width
const DEFAULT_H = 9;   // ~ 290px tall
const MIN_W = 3;
const MIN_H = 5;

interface Tile { x: number; y: number; w: number; h: number; }
type Layout = Record<string, Tile>;

const FONT_KEY = "cadre-fleet-font";
function loadFont(): number {
  try { const v = Number(localStorage.getItem(FONT_KEY)); if (v >= 11 && v <= 24) return v; } catch { /* unavailable */ }
  return 15;
}
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function FleetTab({
  batch,
  projectDir,
  onCloseSubagent,
  onExitSubagent,
}: {
  batch: FleetBatch;
  projectDir: string;
  onCloseSubagent: (taskId: string) => void;
  onExitSubagent: (taskId: string) => void;
}) {
  const [maxId, setMaxId] = useState<string | null>(null);
  const [layout, setLayout] = useState<Layout>({});
  const [font, setFont] = useState<number>(loadFont);
  const [width, setWidth] = useState(0);
  const areaRef = useRef<HTMLDivElement>(null);

  // Measure the grid area width to compute the column width.
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    // Usable width is the content box minus the container's left/right padding.
    const measure = () => setWidth(Math.max(0, el.clientWidth - 2 * GAP));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  // Give every subagent a tile (new ones placed in reading order); prune removed.
  useEffect(() => {
    setLayout((L) => {
      const next: Layout = { ...L };
      batch.subagents.forEach((sa, i) => {
        if (!next[sa.taskId]) next[sa.taskId] = { x: (i % 2) * DEFAULT_W, y: Math.floor(i / 2) * DEFAULT_H, w: DEFAULT_W, h: DEFAULT_H };
      });
      for (const id of Object.keys(next)) if (!batch.subagents.some((s) => s.taskId === id)) delete next[id];
      return next;
    });
  }, [batch.subagents]);

  const setFontClamped = (n: number) => {
    const v = clamp(n, 11, 24);
    setFont(v);
    try { localStorage.setItem(FONT_KEY, String(v)); } catch { /* unavailable */ }
  };

  const colW = width > 0 ? (width - (COLS - 1) * GAP) / COLS : 0;
  const unitX = colW + GAP;
  const unitY = ROW_H + GAP;

  // Drag a tile by its header grip (window listeners → robust across the terminal).
  const startDrag = (taskId: string, e: React.PointerEvent) => {
    e.preventDefault();
    const t = layout[taskId];
    if (!t || colW <= 0) return;
    const px = e.clientX, py = e.clientY;
    const onMove = (ev: PointerEvent) => {
      const nx = clamp(Math.round((t.x * unitX + (ev.clientX - px)) / unitX), 0, COLS - t.w);
      const ny = Math.max(0, Math.round((t.y * unitY + (ev.clientY - py)) / unitY));
      setLayout((L) => ({ ...L, [taskId]: { ...L[taskId], x: nx, y: ny } }));
    };
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Resize a tile by its bottom-right handle.
  const startResize = (taskId: string, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const t = layout[taskId];
    if (!t || colW <= 0) return;
    const px = e.clientX, py = e.clientY;
    const onMove = (ev: PointerEvent) => {
      const w = clamp(Math.round((t.w * unitX + (ev.clientX - px)) / unitX), MIN_W, COLS - t.x);
      const h = clamp(Math.round((t.h * unitY + (ev.clientY - py)) / unitY), MIN_H, 100);
      setLayout((L) => ({ ...L, [taskId]: { ...L[taskId], w, h } }));
    };
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const contentRows = Math.max(1, ...batch.subagents.map((s) => { const t = layout[s.taskId]; return t ? t.y + t.h : 0; }));

  return (
    <div style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* Toolbar: font size + hint */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px var(--c-space-4)", borderBottom: "1px solid var(--c-border)", flexShrink: 0 }}>
        <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>Font</span>
        <div style={{ display: "inline-flex", alignItems: "center", border: "1px solid var(--c-border)", borderRadius: "var(--c-radius-sm)" }}>
          <button onClick={() => setFontClamped(font - 1)} title="Smaller" aria-label="Smaller font" className="cadre-hover" style={fontBtn}><Minus size={12} strokeWidth={2.5} /></button>
          <span style={{ minWidth: 26, textAlign: "center", fontSize: "var(--c-fs-xs)", color: "var(--c-text-secondary)" }}>{font}</span>
          <button onClick={() => setFontClamped(font + 1)} title="Larger" aria-label="Larger font" className="cadre-hover" style={fontBtn}><Plus size={12} strokeWidth={2.5} /></button>
        </div>
        <span style={{ marginLeft: "auto", fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>
          Drag a tile's grip to move · drag its corner to resize
        </span>
      </div>

      {/* Grid area */}
      <div ref={areaRef} style={{ flex: 1, minHeight: 0, overflow: "auto", padding: GAP, position: "relative" }}>
        <div style={{ position: "relative", width: "100%", height: maxId ? "100%" : contentRows * unitY - GAP }}>
          {width > 0 && batch.subagents.map((run) => {
            const t = layout[run.taskId];
            if (!t) return null;
            const isMax = maxId === run.taskId;
            const hidden = maxId != null && !isMax;
            const style: React.CSSProperties = isMax
              ? { position: "absolute", inset: 0 }
              : {
                  position: "absolute",
                  left: t.x * unitX,
                  top: t.y * unitY,
                  width: t.w * colW + (t.w - 1) * GAP,
                  height: t.h * ROW_H + (t.h - 1) * GAP,
                  display: hidden ? "none" : "block",
                };
            return (
              <div key={run.taskId} style={style}>
                <SubagentCard
                  run={run}
                  projectDir={projectDir}
                  maximized={isMax}
                  termFontSize={font}
                  onDragHandlePointerDown={isMax ? undefined : (e) => startDrag(run.taskId, e)}
                  onToggleMax={() => setMaxId((cur) => (cur === run.taskId ? null : run.taskId))}
                  onClose={() => { if (isMax) setMaxId(null); onCloseSubagent(run.taskId); }}
                  onExit={() => onExitSubagent(run.taskId)}
                />
                {!isMax && (
                  <div
                    onPointerDown={(e) => startResize(run.taskId, e)}
                    title="Drag to resize"
                    style={{ position: "absolute", right: 0, bottom: 0, width: 16, height: 16, cursor: "nwse-resize", touchAction: "none", background: "linear-gradient(135deg, transparent 50%, var(--c-border-strong) 50%)", borderBottomRightRadius: "var(--c-radius)" }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const fontBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 22,
  background: "transparent", border: "none", color: "var(--c-text-secondary)", cursor: "pointer",
};
