import { Hexagon } from "lucide-react";
import { PhaseStepper, type Phase } from "./PhaseStepper";

/** The Cockpit top bar: wordmark + phase stepper. */
export function TopBar({
  phase,
  onNavigate,
}: {
  phase: Phase;
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
        <span className="cadre-wordmark" style={{ fontSize: "var(--c-fs-lg)" }}>
          cadre
        </span>
      </div>

      <PhaseStepper current={phase} onNavigate={onNavigate} />

      <div style={{ flex: 1 }} />
    </div>
  );
}
