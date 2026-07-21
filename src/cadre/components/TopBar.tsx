import type { CSSProperties } from "react";
import { Hexagon, Settings, Bell } from "lucide-react";
import { PhaseStepper, type Phase } from "./PhaseStepper";

const iconBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  borderRadius: "var(--c-radius-sm)",
  background: "transparent",
  border: "1px solid transparent",
  color: "var(--c-text-secondary)",
  cursor: "pointer",
};

/** The Cockpit top bar: wordmark, phase stepper, and right-side controls. */
export function TopBar({
  phase,
  needsYou = 0,
  onNavigate,
}: {
  phase: Phase;
  needsYou?: number;
  onNavigate?: (phase: Phase) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--c-space-4)",
        padding: "var(--c-space-2) var(--c-space-4)",
        background: "var(--c-surface-1)",
        borderBottom: "1px solid var(--c-border)",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <Hexagon size={16} strokeWidth={2} style={{ color: "var(--c-accent)" }} />
        <span style={{ fontWeight: 650 as const, fontSize: "var(--c-fs-md)", letterSpacing: "-0.01em" }}>
          cadre
        </span>
      </div>

      <PhaseStepper current={phase} onNavigate={onNavigate} />

      <div style={{ flex: 1 }} />

      {needsYou > 0 && (
        <button
          style={{
            ...iconBtn,
            width: "auto",
            gap: 5,
            padding: "0 10px",
            background: "var(--c-danger-subtle)",
            color: "var(--c-danger)",
            fontSize: "var(--c-fs-sm)",
            fontWeight: 550 as const,
          }}
        >
          <Bell size={13} strokeWidth={2} />
          Needs you ({needsYou})
        </button>
      )}
      <button style={iconBtn} title="Settings">
        <Settings size={15} strokeWidth={2} />
      </button>
    </div>
  );
}
