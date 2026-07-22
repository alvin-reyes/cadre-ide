import { Hexagon, ArrowUp, ArrowDown, PanelRight, Users } from "lucide-react";
import { PhaseStepper, type Phase } from "./PhaseStepper";
import { useUsageStore } from "../../stores/usageStore";

function fmtK(n: number): string {
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}k`;
}

/** The Cockpit top bar: wordmark + phase stepper + session token/cost meter. */
export function TopBar({
  phase,
  onNavigate,
  unlocked,
  onToggleWorkbench,
  workbenchOpen,
  onOpenTeam,
}: {
  phase: Phase;
  onNavigate?: (phase: Phase) => void;
  unlocked?: Partial<Record<Phase, boolean>>;
  onToggleWorkbench?: () => void;
  workbenchOpen?: boolean;
  onOpenTeam?: () => void;
}) {
  const input = useUsageStore((s) => s.input);
  const output = useUsageStore((s) => s.output);
  const cost = useUsageStore((s) => s.costUsd);
  const calls = useUsageStore((s) => s.calls);

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

      <PhaseStepper current={phase} onNavigate={onNavigate} unlocked={unlocked} />

      <div style={{ flex: 1 }} />

      {onOpenTeam && (
        <button
          onClick={onOpenTeam}
          title="Team — your agent fleet"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            height: 24,
            padding: "0 9px",
            borderRadius: "var(--c-radius-sm)",
            background: "transparent",
            border: "1px solid var(--c-border)",
            color: "var(--c-text-secondary)",
            fontSize: "var(--c-fs-xs)",
            fontWeight: 550 as const,
            cursor: "pointer",
          }}
        >
          <Users size={14} strokeWidth={2} />
          Team
        </button>
      )}

      {onToggleWorkbench && (
        <button
          onClick={onToggleWorkbench}
          title="Toggle Workbench (Files · Code · Terminal)"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 24,
            borderRadius: "var(--c-radius-sm)",
            background: workbenchOpen ? "var(--c-surface-3)" : "transparent",
            border: "1px solid var(--c-border)",
            color: workbenchOpen ? "var(--c-accent)" : "var(--c-text-secondary)",
            cursor: "pointer",
          }}
        >
          <PanelRight size={15} strokeWidth={2} />
        </button>
      )}

      <div
        title={`${calls} model call${calls === 1 ? "" : "s"} this session · ${input.toLocaleString()} in / ${output.toLocaleString()} out tokens · estimated cost`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: "var(--c-fs-xs)",
          fontFamily: "var(--c-font-mono)",
          color: "var(--c-text-muted)",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
          <ArrowUp size={11} strokeWidth={2.5} />
          {fmtK(input)}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
          <ArrowDown size={11} strokeWidth={2.5} />
          {fmtK(output)}
        </span>
        <span style={{ color: "var(--c-text-secondary)" }}>~${cost.toFixed(cost < 1 ? 3 : 2)}</span>
      </div>
    </div>
  );
}
