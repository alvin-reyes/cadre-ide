import { Check, Lock } from "lucide-react";

export type Phase = "PLAN" | "SHARD" | "FLEET" | "DONE";

const PHASES: Phase[] = ["PLAN", "SHARD", "FLEET", "DONE"];

/** The always-visible discipline stepper (§4.3). Phases lock until their gate is met. */
export function PhaseStepper({
  current,
  onNavigate,
  unlocked,
}: {
  current: Phase;
  onNavigate?: (phase: Phase) => void;
  /** per-phase accessibility; a phase set to false shows locked and can't be navigated to */
  unlocked?: Partial<Record<Phase, boolean>>;
}) {
  const currentIdx = PHASES.indexOf(current);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--c-space-2)" }}>
      {PHASES.map((phase, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        const locked = unlocked ? unlocked[phase] === false : false;
        return (
          <div key={phase} style={{ display: "flex", alignItems: "center", gap: "var(--c-space-2)" }}>
            <button
              onClick={() => !locked && onNavigate?.(phase)}
              disabled={locked}
              title={locked ? "Locked — finish the previous step first" : undefined}
              style={{
                border: "none",
                cursor: locked ? "not-allowed" : onNavigate ? "pointer" : "default",
                fontSize: "var(--c-fs-xs)",
                letterSpacing: "0.06em",
                fontWeight: 600 as const,
                padding: "3px 10px",
                borderRadius: "var(--c-radius-full)",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                opacity: locked ? 0.45 : 1,
                background: active
                  ? "var(--c-accent)"
                  : done
                    ? "var(--c-success-subtle)"
                    : "var(--c-surface-2)",
                color: active
                  ? "var(--c-on-accent)"
                  : done
                    ? "var(--c-success)"
                    : "var(--c-text-muted)",
                transition: "background var(--c-dur) var(--c-ease-out)",
              }}
            >
              {done && <Check size={11} strokeWidth={2.5} />}
              {phase}
              {locked && <Lock size={9} strokeWidth={2} />}
            </button>
            {i < PHASES.length - 1 && (
              <span style={{ color: "var(--c-text-faint)", fontSize: "var(--c-fs-xs)" }}>→</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
