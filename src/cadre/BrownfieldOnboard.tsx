import { useEffect, useRef } from "react";
import { PackageSearch, Loader2, ArrowRight } from "lucide-react";

/**
 * Guided onboarding for an existing (brownfield) project: read the codebase into a
 * project brief, then plan changes against it. Shown in the PM view until the brief
 * exists. While analyzing, streams the agent's live output.
 */
export function BrownfieldOnboard({
  analyzing,
  output,
  onAnalyze,
  disabled,
}: {
  analyzing: boolean;
  output: string;
  onAnalyze: () => void;
  disabled: boolean;
}) {
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [output]);

  const steps = [
    { n: 1, label: "Analyze", desc: "read the whole codebase (2 passes)" },
    { n: 2, label: "Review the brief", desc: "the as-is architecture + stack" },
    { n: 3, label: "Describe your change", desc: "the PM plans against it" },
  ];

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--c-space-5)" }}>
      <div style={{ width: 520, maxWidth: "100%" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 9, marginBottom: "var(--c-space-3)" }}>
          <PackageSearch size={20} strokeWidth={2} style={{ color: "var(--c-accent)" }} />
          <span style={{ fontSize: "var(--c-fs-xl)", fontWeight: 600 as const, color: "var(--c-text)" }}>Existing project</span>
        </div>
        <p style={{ fontSize: "var(--c-fs-md)", lineHeight: 1.6, color: "var(--c-text-secondary)", marginBottom: "var(--c-space-4)" }}>
          Cadre plans best when it understands your code first. I'll read the whole codebase into a
          project brief — the as-is architecture, stack, and test command — then you tell the PM what
          to change or add, and everything is planned against what's really there.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--c-space-2)", marginBottom: "var(--c-space-4)" }}>
          {steps.map((s) => (
            <div key={s.n} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: "50%", background: "var(--c-surface-2)", border: "1px solid var(--c-border-strong)", color: "var(--c-text-secondary)", fontSize: "var(--c-fs-xs)", fontWeight: 600 as const, flexShrink: 0 }}>
                {s.n}
              </span>
              <span style={{ fontSize: "var(--c-fs-sm)", color: "var(--c-text)", fontWeight: 550 as const }}>{s.label}</span>
              <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)" }}>— {s.desc}</span>
            </div>
          ))}
        </div>

        {analyzing ? (
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--c-fs-sm)", color: "var(--c-accent)", marginBottom: 8 }}>
              <Loader2 size={14} strokeWidth={2.5} className="cadre-spin" /> Reading the codebase…
            </div>
            <pre
              ref={logRef}
              style={{
                margin: 0,
                maxHeight: 180,
                overflow: "auto",
                background: "var(--c-code-bg)",
                border: "1px solid var(--c-border)",
                borderRadius: "var(--c-radius)",
                padding: "var(--c-space-3)",
                fontFamily: "var(--c-font-mono)",
                fontSize: "var(--c-fs-xs)",
                lineHeight: 1.5,
                color: "var(--c-text-secondary)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {output || "Starting the analysis agent…"}
            </pre>
          </div>
        ) : (
          <button
            onClick={onAnalyze}
            disabled={disabled}
            title={disabled ? "Add your API key first" : "Read the whole codebase into a project brief"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: "var(--c-fs-md)",
              fontWeight: 550 as const,
              padding: "9px 16px",
              borderRadius: "var(--c-radius)",
              background: disabled ? "var(--c-surface-3)" : "var(--c-accent)",
              color: disabled ? "var(--c-text-muted)" : "var(--c-on-accent)",
              border: "none",
              cursor: disabled ? "default" : "pointer",
            }}
          >
            Analyze the codebase
            <ArrowRight size={15} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>
  );
}
