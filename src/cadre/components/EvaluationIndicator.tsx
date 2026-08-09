/**
 * EvaluationIndicator — the global top-bar notification bar for the background
 * Guardian + Audit agents. Shows a shield with a finding-count badge (coloured by
 * worst severity); clicking opens a panel listing findings (dismiss individually),
 * with "Evaluate now" and an "Auto" toggle that re-runs on an interval.
 */
import { useEffect, useState } from "react";
import { Shield, ShieldAlert, RefreshCw, X, ShieldCheck, ClipboardCheck } from "lucide-react";
import { useBmadStore } from "../../stores/bmadStore";
import { useEvaluationStore } from "../../stores/evaluationStore";
import { severityRank, type EvalAgent, type Finding, type Severity } from "../../lib/maintain/evaluation";

const AUTO_KEY = "cadre-eval-auto";
const INTERVAL_MS = 10 * 60 * 1000; // 10 min

function sevColor(s: Severity): string {
  return s === "critical" ? "var(--c-danger)" : s === "warning" ? "var(--c-warning)" : "var(--c-accent)";
}
function agentLabel(a: EvalAgent): string {
  return a === "guardian" ? "Guardian" : "Audit";
}
function ago(ms: number | null): string {
  if (!ms) return "never";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
}

export function EvaluationIndicator() {
  const root = useBmadStore((s) => s.projectRoot);
  const findings = useEvaluationStore((s) => s.findings);
  const running = useEvaluationStore((s) => s.running);
  const lastRunAt = useEvaluationStore((s) => s.lastRunAt);
  const open = useEvaluationStore((s) => s.panelOpen);
  const setOpen = useEvaluationStore((s) => s.setPanelOpen);
  const evaluate = useEvaluationStore((s) => s.evaluate);
  const dismiss = useEvaluationStore((s) => s.dismiss);
  const [auto, setAuto] = useState(() => { try { return localStorage.getItem(AUTO_KEY) === "1"; } catch { return false; } });

  const mine = root ? findings.filter((f) => f.root === root) : [];
  const worst = mine.reduce<Severity | null>(
    (acc, f) => (acc == null || severityRank(f.severity) < severityRank(acc) ? f.severity : acc),
    null,
  );
  const sorted = [...mine].sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.agent.localeCompare(b.agent));

  // Optional interval re-run while Auto is on.
  useEffect(() => {
    if (!auto || !root) return;
    const id = setInterval(() => { if (!useEvaluationStore.getState().running) void evaluate(root); }, INTERVAL_MS);
    return () => clearInterval(id);
  }, [auto, root, evaluate]);

  const toggleAuto = () => setAuto((a) => { const next = !a; try { localStorage.setItem(AUTO_KEY, next ? "1" : "0"); } catch { /* */ } return next; });

  if (!root) return null;

  const badgeColor = worst ? sevColor(worst) : "var(--c-text-muted)";

  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button
        onClick={() => setOpen(!open)}
        title="Guardian & Audit findings"
        aria-label="Guardian and Audit findings"
        aria-pressed={open}
        className="cadre-icon-btn cadre-hover"
        style={{ position: "relative", width: 28, height: 24 }}
      >
        {running ? <RefreshCw size={15} strokeWidth={2} className="cadre-spin" /> : mine.length > 0 ? <ShieldAlert size={15} strokeWidth={2} style={{ color: badgeColor }} /> : <Shield size={15} strokeWidth={2} />}
        {mine.length > 0 && (
          <span style={{ position: "absolute", top: -5, right: -5, minWidth: 15, height: 15, padding: "0 3px", borderRadius: "var(--c-radius-full)", background: badgeColor, color: "var(--c-on-accent)", fontSize: "9px", fontWeight: 700, lineHeight: "15px", textAlign: "center" }}>
            {mine.length}
          </span>
        )}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
          <div className="cadre-elevate" style={{ position: "absolute", top: 32, right: 0, zIndex: 61, width: 380, maxHeight: "70vh", display: "flex", flexDirection: "column", background: "var(--c-surface-1)", border: "1px solid var(--c-border-strong)", borderRadius: "var(--c-radius)", overflow: "hidden" }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "var(--c-space-3)", borderBottom: "1px solid var(--c-border)" }}>
              <ShieldCheck size={14} strokeWidth={2} style={{ color: "var(--c-accent)" }} />
              <span style={{ fontSize: "var(--c-fs-sm)", fontWeight: 650, color: "var(--c-text)" }}>Guardian &amp; Audit</span>
              <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>{running ? "reviewing…" : `ran ${ago(lastRunAt)}`}</span>
              <button onClick={() => setOpen(false)} aria-label="Close" className="cadre-hover" style={{ marginLeft: "auto", display: "inline-flex", background: "transparent", border: "none", color: "var(--c-text-muted)", cursor: "pointer", padding: 2, borderRadius: "var(--c-radius-sm)" }}>
                <X size={14} strokeWidth={2} />
              </button>
            </div>

            {/* Controls */}
            <div style={{ display: "flex", alignItems: "center", gap: "var(--c-space-2)", padding: "var(--c-space-2) var(--c-space-3)", borderBottom: "1px solid var(--c-border)" }}>
              <button onClick={() => void evaluate(root)} disabled={running} className={running ? undefined : "cadre-btn-primary"} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--c-fs-sm)", fontWeight: 550, padding: "5px 12px", borderRadius: "var(--c-radius)", border: "none", background: running ? "var(--c-surface-3)" : undefined, color: running ? "var(--c-text-muted)" : undefined, cursor: running ? "default" : "pointer" }}>
                <RefreshCw size={13} strokeWidth={2.5} className={running ? "cadre-spin" : undefined} /> Evaluate now
              </button>
              <label style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--c-fs-xs)", color: "var(--c-text-secondary)", cursor: "pointer" }}>
                <input type="checkbox" checked={auto} onChange={toggleAuto} style={{ accentColor: "var(--c-accent)", cursor: "pointer" }} />
                Auto (every 10m)
              </label>
            </div>

            {/* Findings */}
            <div style={{ flex: 1, overflow: "auto", padding: "var(--c-space-2)" }}>
              {mine.length === 0 ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "var(--c-space-5) var(--c-space-4)", textAlign: "center", color: "var(--c-text-muted)" }}>
                  <ClipboardCheck size={22} strokeWidth={1.5} style={{ color: "var(--c-text-faint)" }} />
                  <span style={{ fontSize: "var(--c-fs-sm)", fontWeight: 550, color: "var(--c-text-secondary)" }}>{running ? "Agents are reviewing the changes…" : "No findings"}</span>
                  {!running && <span style={{ fontSize: "var(--c-fs-xs)", maxWidth: 260, lineHeight: 1.5 }}>Run Guardian &amp; Audit to review this project's current git changes.</span>}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {sorted.map((f) => <FindingRow key={f.id} f={f} onDismiss={() => dismiss(f.id)} />)}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FindingRow({ f, onDismiss }: { f: Finding; onDismiss: () => void }) {
  const color = sevColor(f.severity);
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "var(--c-space-2) var(--c-space-3)", background: "var(--c-surface-2)", border: "1px solid var(--c-border)", borderRadius: "var(--c-radius-sm)", borderLeft: `3px solid ${color}` }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="cadre-label-mono" style={{ fontSize: "9px", fontWeight: 700, color, letterSpacing: "0.04em" }}>{agentLabel(f.agent)}</span>
          <span style={{ fontSize: "var(--c-fs-sm)", fontWeight: 600, color: "var(--c-text)", lineHeight: 1.35 }}>{f.title}</span>
        </div>
        {f.detail && <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-secondary)", lineHeight: 1.5, wordBreak: "break-word" }}>{f.detail}</span>}
      </div>
      <button onClick={onDismiss} title="Dismiss" aria-label="Dismiss finding" className="cadre-hover" style={{ display: "inline-flex", background: "transparent", border: "none", color: "var(--c-text-faint)", cursor: "pointer", padding: 2, borderRadius: "var(--c-radius-sm)", flexShrink: 0 }}>
        <X size={12} strokeWidth={2.5} />
      </button>
    </div>
  );
}
