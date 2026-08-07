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
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PromptsRail onPick={(body) => setThought((cur) => (cur ? `${cur}\n${body}` : body))} />

      {/* Thoughts composer */}
      <div style={{ borderTop: "1px solid var(--c-border)", padding: "var(--c-space-2) var(--c-space-3)", display: "flex", flexDirection: "column", gap: "var(--c-space-2)" }}>
        <textarea value={thought} onChange={(e) => setThought(e.target.value)} placeholder="Compose a task — pull a prompt above or type your own…" rows={3} style={{ width: "100%", resize: "none", border: "1px solid var(--c-border-strong)", borderRadius: "var(--c-radius)", background: "var(--c-surface-2)", color: "var(--c-text)", fontFamily: "inherit", fontSize: "var(--c-fs-base)", padding: "var(--c-space-2)", outline: "none" }} />
        <button onClick={add} disabled={!thought.trim()} className="cadre-hover" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: "var(--c-fs-sm)", fontWeight: 550, padding: "5px 12px", borderRadius: "var(--c-radius)", border: "1px solid var(--c-border)", background: "var(--c-surface-2)", color: thought.trim() ? "var(--c-text)" : "var(--c-text-muted)", cursor: thought.trim() ? "pointer" : "default" }}>
          <Plus size={13} strokeWidth={2.5} /> Add to list
        </button>
      </div>

      {/* Staged list + Run all */}
      <div style={{ borderTop: "1px solid var(--c-border)", display: "flex", flexDirection: "column", minHeight: 0, flexShrink: 0, maxHeight: "40%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "var(--c-space-2) var(--c-space-3)" }}>
          <ListTodo size={13} style={{ color: "var(--c-text-muted)" }} />
          <span style={{ fontSize: "var(--c-fs-sm)", fontWeight: 600, color: "var(--c-text)" }}>Staged</span>
          <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>{staged.length}</span>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "0 var(--c-space-3)", display: "flex", flexDirection: "column", gap: 4 }}>
          {staged.map((t) => (
            <div key={t.id} style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "var(--c-space-2)", background: "var(--c-surface-2)", border: "1px solid var(--c-border)", borderRadius: "var(--c-radius-sm)" }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: "var(--c-fs-sm)", color: "var(--c-text)", wordBreak: "break-word" }}>{t.prompt}</span>
              <button onClick={() => unstageTask(t.id)} title="Remove" aria-label="Remove staged task" style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--c-text-faint)", padding: 0, display: "inline-flex" }}>
                <X size={12} strokeWidth={2.5} />
              </button>
            </div>
          ))}
        </div>
        <div style={{ padding: "var(--c-space-2) var(--c-space-3)" }}>
          <button onClick={() => void runAll()} disabled={staged.length === 0 || running} className={staged.length > 0 && !running ? "cadre-btn-primary" : undefined} style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: "var(--c-fs-sm)", fontWeight: 600, padding: "7px 12px", borderRadius: "var(--c-radius)", border: "none", background: staged.length > 0 && !running ? undefined : "var(--c-surface-3)", color: staged.length > 0 && !running ? undefined : "var(--c-text-muted)", cursor: staged.length > 0 && !running ? "pointer" : "default" }}>
            <Play size={13} strokeWidth={2.5} /> Run all{staged.length > 0 ? ` (${staged.length})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
