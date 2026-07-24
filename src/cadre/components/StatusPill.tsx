import type { Status } from "../../lib/engine/status";

const STYLES: Record<Status, { bg: string; fg: string; label: string }> = {
  Draft: { bg: "var(--c-surface-3)", fg: "var(--c-text-muted)", label: "Draft" },
  Approved: { bg: "var(--c-accent-subtle)", fg: "var(--c-accent)", label: "Approved" },
  InProgress: { bg: "var(--c-accent-subtle)", fg: "var(--c-accent)", label: "In Progress" },
  InReview: { bg: "var(--c-warning-subtle)", fg: "var(--c-warning)", label: "In Review" },
  Done: { bg: "var(--c-success-subtle)", fg: "var(--c-success)", label: "Done" },
  Failed: { bg: "var(--c-danger-subtle)", fg: "var(--c-danger)", label: "Failed" },
  Blocked: { bg: "var(--c-danger-subtle)", fg: "var(--c-danger)", label: "Blocked" },
};

export function StatusPill({ status, interrupted }: { status: Status; interrupted?: boolean }) {
  // An orphaned in-flight story reads as "Interrupted", not the busy status it
  // was frozen at, so the board doesn't imply a run that isn't happening.
  const s = interrupted
    ? { bg: "var(--c-warning-subtle)", fg: "var(--c-warning)", label: "Interrupted" }
    : STYLES[status];
  return (
    <span
      className="cadre-label-mono"
      style={{
        fontSize: "9px",
        fontWeight: 600 as const,
        padding: "2px 7px",
        borderRadius: "var(--c-radius-sm)",
        background: s.bg,
        color: s.fg,
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}
