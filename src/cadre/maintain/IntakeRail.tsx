/**
 * IntakeRail — the Maintain cockpit's left rail. PromptsRail (library) feeds a
 * Thoughts composer (staging text); "Add to list" stages a task; "Run all"
 * freezes the staged list into a fleet batch and hands the new batch id up so
 * the parent opens its Fleet tab.
 */
import { useState } from "react";
import { ListTodo, Plus, Play, X } from "lucide-react";
import { PromptsRail } from "./PromptsRail";
import { useCadre } from "../useCadre";
import { aiLog } from "../../stores/aiLogStore";
import { toast } from "../../stores/toastStore";

export function IntakeRail({ onBatchLaunched }: { onBatchLaunched: (batchId: string) => void }) {
  const staged = useCadre((s) => s.stagedTasks);
  const stageTask = useCadre((s) => s.stageTask);
  const unstageTask = useCadre((s) => s.unstageTask);
  const runStagedBatch = useCadre((s) => s.runStagedBatch);

  const [thought, setThought] = useState("");
  const [running, setRunning] = useState(false);

  const add = () => { const t = thought.trim(); if (!t) return; stageTask(t); setThought(""); };
  const runAll = async () => {
    setRunning(true);
    try {
      const id = await runStagedBatch();
      if (id) onBatchLaunched(id);
    } catch (e) {
      aiLog("maintain", `Run failed: ${String(e)}\n`, "error");
      toast(`Run failed: ${String(e)}`, "error");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PromptsRail onPick={(body) => setThought((cur) => (cur ? `${cur}\n${body}` : body))} />

      {/* Thoughts composer */}
      <div style={{ borderTop: "1px solid var(--c-border)", padding: "var(--c-space-3)", display: "flex", flexDirection: "column", gap: "var(--c-space-2)" }}>
        <span className="cadre-label-mono" style={{ fontSize: "9px", fontWeight: 700, color: "var(--c-text-muted)", letterSpacing: "0.06em" }}>Compose</span>
        <textarea className="cadre-input" value={thought} onChange={(e) => setThought(e.target.value)} placeholder="Compose a task — pull a prompt above or type your own…" rows={3} style={{ width: "100%", resize: "none", fontFamily: "inherit", fontSize: "var(--c-fs-base)", lineHeight: 1.5, padding: "var(--c-space-2) var(--c-space-3)" }} />
        <button onClick={add} disabled={!thought.trim()} className="cadre-icon-btn cadre-hover" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, height: 30, fontSize: "var(--c-fs-sm)", fontWeight: 550, color: thought.trim() ? "var(--c-text)" : "var(--c-text-muted)", cursor: thought.trim() ? "pointer" : "default" }}>
          <Plus size={13} strokeWidth={2.5} /> Add to list
        </button>
      </div>

      {/* Staged list + Run all */}
      <div style={{ borderTop: "1px solid var(--c-border)", display: "flex", flexDirection: "column", minHeight: 0, flexShrink: 0, maxHeight: "42%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "var(--c-space-3) var(--c-space-3) var(--c-space-2)" }}>
          <ListTodo size={12} style={{ color: "var(--c-text-muted)" }} />
          <span className="cadre-label-mono" style={{ fontSize: "9px", fontWeight: 700, color: "var(--c-text-muted)", letterSpacing: "0.06em" }}>Staged</span>
          {staged.length > 0 && (
            <span style={{ fontSize: "9px", fontWeight: 700, color: "var(--c-accent)", background: "var(--c-accent-subtle)", borderRadius: "var(--c-radius-full)", padding: "0 6px", lineHeight: "15px" }}>{staged.length}</span>
          )}
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "0 var(--c-space-3) var(--c-space-2)", display: "flex", flexDirection: "column", gap: 5 }}>
          {staged.length === 0 ? (
            <div style={{ padding: "var(--c-space-3)", fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)", lineHeight: 1.5 }}>
              Nothing staged. Compose a task above, then Run all to launch the fleet.
            </div>
          ) : staged.map((t) => (
            <div key={t.id} className="cadre-hover" style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "var(--c-space-2) var(--c-space-3)", background: "var(--c-surface-2)", border: "1px solid var(--c-border)", borderRadius: "var(--c-radius-sm)" }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: "var(--c-fs-sm)", color: "var(--c-text)", lineHeight: 1.45, wordBreak: "break-word" }}>{t.prompt}</span>
              <button onClick={() => unstageTask(t.id)} title="Remove" aria-label="Remove staged task" style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--c-text-faint)", padding: 0, marginTop: 1, display: "inline-flex" }}>
                <X size={12} strokeWidth={2.5} />
              </button>
            </div>
          ))}
        </div>
        <div style={{ padding: "var(--c-space-2) var(--c-space-3) var(--c-space-3)" }}>
          <button onClick={() => void runAll()} disabled={staged.length === 0 || running} className={staged.length > 0 && !running ? "cadre-btn-primary" : undefined} style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: "var(--c-fs-sm)", fontWeight: 600, padding: "8px 12px", borderRadius: "var(--c-radius)", border: "none", background: staged.length > 0 && !running ? undefined : "var(--c-surface-3)", color: staged.length > 0 && !running ? undefined : "var(--c-text-muted)", cursor: staged.length > 0 && !running ? "pointer" : "default" }}>
            <Play size={13} strokeWidth={2.5} /> Run all{staged.length > 0 ? ` (${staged.length})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
