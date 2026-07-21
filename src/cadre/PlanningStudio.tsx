import { useState, type CSSProperties } from "react";
import { Lock, ArrowUp, FileText, PencilRuler } from "lucide-react";

const paneHead: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--c-space-2)",
  padding: "var(--c-space-2) var(--c-space-4)",
  borderBottom: "1px solid var(--c-border)",
  flexShrink: 0,
};

const personaBadge: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: "var(--c-fs-sm)",
  color: "var(--c-accent)",
  background: "var(--c-accent-subtle)",
  border: "1px solid var(--c-accent-ring)",
  borderRadius: "var(--c-radius-full)",
  padding: "2px 10px",
};

const chip: CSSProperties = {
  fontSize: "var(--c-fs-sm)",
  color: "var(--c-text-secondary)",
  background: "var(--c-surface-2)",
  border: "1px solid var(--c-border)",
  borderRadius: "var(--c-radius-full)",
  padding: "4px 11px",
  cursor: "pointer",
};

/** Planning Studio zero-state: talk to the PM on the left; the PRD forms right. */
export function PlanningStudio() {
  const [draft, setDraft] = useState("");

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Conversation */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={paneHead}>
            <span style={personaBadge}>
              <PencilRuler size={13} strokeWidth={2} /> PM · John
            </span>
            <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)" }}>
              Product Manager · here to shape your PRD
            </span>
          </div>

          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              padding: "var(--c-space-5)",
              overflow: "auto",
            }}
          >
            <p
              style={{
                fontSize: "var(--c-fs-md)",
                lineHeight: 1.6,
                color: "var(--c-text-secondary)",
                maxWidth: 380,
              }}
            >
              Hi — I'm <b style={{ color: "var(--c-text)" }}>John</b>, your PM. Tell me
              what you want to build and I'll help turn it into a real PRD. When the plan
              and architecture are solid, we hand off to the fleet — which{" "}
              <b style={{ color: "var(--c-text)" }}>proves</b> every story before it's done.
            </p>

            <div style={{ marginTop: "auto" }}>
              <div
                style={{
                  fontSize: "var(--c-fs-xl)",
                  fontWeight: 600 as const,
                  letterSpacing: "-0.01em",
                  marginBottom: "var(--c-space-3)",
                }}
              >
                What do you want to build?
              </div>

              <div style={{ display: "flex", gap: "var(--c-space-2)", marginBottom: "var(--c-space-3)" }}>
                <span style={chip}>Blank</span>
                <span style={chip}>From a doc</span>
                <span style={chip}>Existing project</span>
                <span style={chip}>Try the sample</span>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--c-space-2)",
                  background: "var(--c-surface-1)",
                  border: "1px solid var(--c-border-strong)",
                  borderRadius: "var(--c-radius-lg)",
                  padding: "10px 10px 10px 14px",
                }}
              >
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Describe your idea…"
                  style={{
                    flex: 1,
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    color: "var(--c-text)",
                    fontSize: "var(--c-fs-md)",
                    fontFamily: "var(--c-font-ui)",
                  }}
                />
                <button
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 30,
                    height: 30,
                    borderRadius: "var(--c-radius)",
                    background: draft.trim() ? "var(--c-accent)" : "var(--c-surface-3)",
                    color: draft.trim() ? "var(--c-on-accent)" : "var(--c-text-muted)",
                    border: "none",
                    cursor: draft.trim() ? "pointer" : "default",
                    transition: "background var(--c-dur) var(--c-ease-out)",
                  }}
                >
                  <ArrowUp size={16} strokeWidth={2.5} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Live document */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            borderLeft: "1px solid var(--c-border)",
            background: "var(--c-bg)",
            minWidth: 0,
          }}
        >
          <div style={paneHead}>
            <FileText size={13} strokeWidth={2} style={{ color: "var(--c-text-muted)" }} />
            <span style={{ fontSize: "var(--c-fs-sm)", fontFamily: "var(--c-font-mono)", color: "var(--c-text-secondary)" }}>
              docs/prd.md
            </span>
            <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>
              writes itself as you talk
            </span>
          </div>
          <div style={{ padding: "var(--c-space-5)", display: "flex", flexDirection: "column", gap: 10 }}>
            <Skeleton w="55%" h={13} />
            <Skeleton w="90%" />
            <Skeleton w="80%" />
            <Skeleton w="70%" />
            <div
              style={{
                marginTop: "var(--c-space-5)",
                textAlign: "center",
                color: "var(--c-text-faint)",
                fontSize: "var(--c-fs-sm)",
              }}
            >
              Your PRD appears here, section by section, as you and John talk it through.
            </div>
          </div>
        </div>
      </div>

      {/* Locked gate */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--c-space-2)",
          padding: "9px",
          background: "var(--c-danger-subtle)",
          borderTop: "1px solid var(--c-border)",
          color: "var(--c-danger)",
          fontSize: "var(--c-fs-sm)",
          flexShrink: 0,
        }}
      >
        <Lock size={12} strokeWidth={2} />
        Fleet locked — approve a PRD + architecture (and confirm the test command) to dispatch.
      </div>
    </div>
  );
}

function Skeleton({ w, h = 9 }: { w: string; h?: number }) {
  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: 5,
        background: "var(--c-surface-2)",
      }}
    />
  );
}
