import { Check } from "lucide-react";

export type Phase = "PLAN" | "SHARD" | "FLEET" | "DONE";

const PHASES: Phase[] = ["PLAN", "SHARD", "FLEET", "DONE"];

/** The always-visible discipline stepper (§4.3). */
export function PhaseStepper({ current }: { current: Phase }) {
  const currentIdx = PHASES.indexOf(current);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--c-space-2)" }}>
      {PHASES.map((phase, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <div key={phase} style={{ display: "flex", alignItems: "center", gap: "var(--c-space-2)" }}>
            <span
              style={{
                fontSize: "var(--c-fs-xs)",
                letterSpacing: "0.06em",
                fontWeight: 600 as const,
                padding: "3px 10px",
                borderRadius: "var(--c-radius-full)",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
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
            </span>
            {i < PHASES.length - 1 && (
              <span style={{ color: "var(--c-text-faint)", fontSize: "var(--c-fs-xs)" }}>→</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
