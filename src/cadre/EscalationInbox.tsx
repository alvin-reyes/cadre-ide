import { Check, X, RotateCcw, ChevronRight, ShieldCheck, FileText, FlaskConical } from "lucide-react";

export type InboxKind = "plan" | "story" | "qa-fail";

export interface InboxItem {
  id: string;
  kind: InboxKind;
  title: string;
  why: string;
  context?: string;
}

// Demo items until real blocked-on-human items flow from the engine.
const DEMO: InboxItem[] = [
  {
    id: "plan",
    kind: "plan",
    title: "Approve plan — Billing epic",
    why: "PRD + architecture ready. Confirm the verification command to unlock the fleet.",
    context: "verify: pnpm test --filter billing",
  },
  {
    id: "1.2-qa",
    kind: "qa-fail",
    title: "Story 1.2 · API rate-limit — QA failed",
    why: "cadre ran verify → 2 of 3 passing. throttle.spec.ts: burst window off by 1.",
  },
  {
    id: "2.1-approve",
    kind: "story",
    title: "Approve story — 2.1 Session store (Draft)",
    why: "The SM drafted a fully-specified story. Approve to make it dispatchable.",
  },
];

const KIND_ICON = {
  plan: ShieldCheck,
  story: FileText,
  "qa-fail": FlaskConical,
} as const;

const KIND_ACCENT: Record<InboxKind, string> = {
  plan: "var(--c-accent)",
  story: "var(--c-accent)",
  "qa-fail": "var(--c-danger)",
};

export function EscalationInbox({ onClose }: { onClose: () => void }) {
  const items = DEMO;
  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 40 }}
      />
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 400,
          background: "var(--c-surface-1)",
          borderLeft: "1px solid var(--c-border-strong)",
          boxShadow: "var(--c-elev-3)",
          zIndex: 41,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "var(--c-space-3) var(--c-space-4)",
            borderBottom: "1px solid var(--c-border)",
          }}
        >
          <span style={{ fontSize: "var(--c-fs-md)", fontWeight: 600 as const }}>
            Needs you ({items.length})
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{
              display: "inline-flex",
              width: 26,
              height: 26,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "var(--c-radius-sm)",
              background: "transparent",
              border: "none",
              color: "var(--c-text-secondary)",
              cursor: "pointer",
            }}
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "var(--c-space-3)" }}>
          {items.map((item) => (
            <InboxCard key={item.id} item={item} />
          ))}
        </div>
      </div>
    </>
  );
}

function InboxCard({ item }: { item: InboxItem }) {
  const Icon = KIND_ICON[item.kind];
  const isFail = item.kind === "qa-fail";
  return (
    <div
      style={{
        background: "var(--c-surface-2)",
        border: "1px solid var(--c-border)",
        borderLeft: `3px solid ${KIND_ACCENT[item.kind]}`,
        borderRadius: "var(--c-radius)",
        padding: "var(--c-space-3)",
        marginBottom: "var(--c-space-2)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
        <Icon size={14} strokeWidth={2} style={{ color: KIND_ACCENT[item.kind] }} />
        <span style={{ fontSize: "var(--c-fs-sm)", color: "var(--c-text)", fontWeight: 550 as const }}>
          {item.title}
        </span>
      </div>
      <div style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-secondary)", lineHeight: 1.5, marginBottom: 8 }}>
        {item.why}
      </div>
      {item.context && (
        <div
          style={{
            fontFamily: "var(--c-font-mono)",
            fontSize: "var(--c-fs-xs)",
            color: "var(--c-success)",
            background: "var(--c-bg)",
            border: "1px solid var(--c-border)",
            borderRadius: "var(--c-radius-sm)",
            padding: "5px 8px",
            marginBottom: 8,
          }}
        >
          {item.context}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {isFail ? (
          <Action label="Redirect" icon={RotateCcw} tone="accent" />
        ) : (
          <Action label="Approve" icon={Check} tone="success" />
        )}
        <Action label="Reject" icon={X} tone="danger" />
        <Action label="View" icon={ChevronRight} tone="muted" />
      </div>
    </div>
  );
}

const TONES = {
  success: { bg: "var(--c-success-subtle)", fg: "var(--c-success)", bd: "var(--c-success)" },
  danger: { bg: "var(--c-danger-subtle)", fg: "var(--c-danger)", bd: "var(--c-danger)" },
  accent: { bg: "var(--c-accent-subtle)", fg: "var(--c-accent)", bd: "var(--c-accent-ring)" },
  muted: { bg: "var(--c-surface-3)", fg: "var(--c-text-secondary)", bd: "var(--c-border)" },
} as const;

function Action({
  label,
  icon: Icon,
  tone,
}: {
  label: string;
  icon: typeof Check;
  tone: keyof typeof TONES;
}) {
  const t = TONES[tone];
  return (
    <button
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: "var(--c-fs-xs)",
        fontWeight: 550 as const,
        padding: "4px 9px",
        borderRadius: "var(--c-radius-sm)",
        background: t.bg,
        color: t.fg,
        border: `1px solid ${t.bd}`,
        cursor: "pointer",
      }}
    >
      <Icon size={12} strokeWidth={2} />
      {label}
    </button>
  );
}
