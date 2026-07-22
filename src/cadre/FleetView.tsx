import { useState, useEffect, useRef } from "react";
import { Circle, Plus, Play, Cpu, MessageSquarePlus, AlertTriangle, RefreshCw, ShieldCheck, ShieldAlert, Gavel, FileDown } from "lucide-react";
import { FleetBoard } from "./components/FleetBoard";
import { Markdown } from "./components/Markdown";
import { exportHtmlToPdf } from "./exportPdf";
import { useBmadStore } from "../stores/bmadStore";
import { useCadre } from "./useCadre";
import { aggregateReviews, type LensReview } from "../lib/engine/reviewFleet";
import { PROVIDERS, getProvider } from "../lib/engine/providers";
import { secretHas, secretSet } from "../lib/secrets";
import type { StoryCard } from "../lib/engine/board";
import type { Status } from "../lib/engine/status";

// How each engine Status reads in the agent pane (the thesis: cadre verifies).
function stateInfo(status: Status): { label: string; color: string; live: boolean } {
  switch (status) {
    case "InProgress":
      return { label: "Agent working — cadre verifies before Done", color: "var(--c-accent)", live: true };
    case "InReview":
      return { label: "Verifying — running the frozen command", color: "var(--c-warning)", live: true };
    case "Done":
      return { label: "Verified — Done", color: "var(--c-success)", live: false };
    case "Failed":
      return { label: "Failed verification — bounce to fix", color: "var(--c-danger)", live: false };
    case "Blocked":
      return { label: "Blocked", color: "var(--c-danger)", live: false };
    default:
      return { label: "Ready to dispatch", color: "var(--c-text-muted)", live: false };
  }
}

export function FleetView() {
  const stories = useBmadStore((s) => s.stories);
  const projectRoot = useBmadStore((s) => s.projectRoot);
  const shardNextStory = useCadre((s) => s.shardNextStory);
  const cascadeReplan = useCadre((s) => s.cascadeReplan);
  const approvePlan = useCadre((s) => s.approvePlan);
  const verification = useCadre((s) => s.verification);
  const needsReplan = useCadre((s) => s.needsReplan);
  const setPhase = useCadre((s) => s.setPhase);
  const busy = useCadre((s) => s.busy);
  const error = useCadre((s) => s.error);

  // No project = UI preview: real (empty) board, actions gated off. No fake data.
  const preview = !projectRoot;
  const display = stories;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = display.find((c) => c.id === selectedId) ?? display[0] ?? null;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Fleet toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--c-space-3)",
          padding: "var(--c-space-2) var(--c-space-4)",
          borderBottom: "1px solid var(--c-border)",
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => shardNextStory(1)}
          disabled={preview || !!busy}
          title={preview ? "Open a project to shard stories" : "Run the SM to shard the next story"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: "var(--c-fs-sm)",
            fontWeight: 550 as const,
            padding: "5px 12px",
            borderRadius: "var(--c-radius)",
            background: preview || busy ? "var(--c-surface-3)" : "var(--c-accent)",
            color: preview || busy ? "var(--c-text-muted)" : "var(--c-on-accent)",
            border: "none",
            cursor: preview || busy ? "default" : "pointer",
          }}
        >
          <Plus size={14} strokeWidth={2.5} />
          Generate story (SM)
        </button>
        <span style={{ fontSize: "var(--c-fs-xs)", color: busy ? "var(--c-accent)" : error ? "var(--c-danger)" : "var(--c-text-muted)" }}>
          {busy ?? error ?? (preview ? "Preview — open a project to run the fleet." : `${stories.length} stor${stories.length === 1 ? "y" : "ies"}`)}
        </span>
        <div style={{ flex: 1 }} />
        {!preview && (
          <button
            onClick={() => setPhase("PLAN")}
            title="Add a requirement or change scope — routes back to the PM to amend the plan"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: "var(--c-fs-sm)",
              fontWeight: 550 as const,
              padding: "5px 11px",
              borderRadius: "var(--c-radius)",
              background: "transparent",
              color: "var(--c-text-secondary)",
              border: "1px solid var(--c-border-strong)",
              cursor: "pointer",
            }}
          >
            <MessageSquarePlus size={14} strokeWidth={2} />
            New requirement
          </button>
        )}
        {!preview && <FleetModelPicker />}
      </div>

      {!preview && needsReplan && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--c-space-3)",
            padding: "8px var(--c-space-4)",
            background: "var(--c-warning-subtle)",
            borderBottom: "1px solid var(--c-border)",
            flexShrink: 0,
          }}
        >
          <AlertTriangle size={14} strokeWidth={2} style={{ color: "var(--c-warning)", flexShrink: 0 }} />
          <span style={{ fontSize: "var(--c-fs-sm)", color: "var(--c-text-secondary)" }}>
            Scope changed — dispatch is paused until the updated plan is re-approved.
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => cascadeReplan()}
            disabled={!!busy}
            title="Re-run the Architect (and Designer) and shard a story for the new scope"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: "var(--c-fs-sm)",
              fontWeight: 550 as const,
              padding: "5px 11px",
              borderRadius: "var(--c-radius)",
              background: busy ? "var(--c-surface-3)" : "var(--c-surface-2)",
              color: busy ? "var(--c-text-muted)" : "var(--c-text)",
              border: "1px solid var(--c-border-strong)",
              cursor: busy ? "default" : "pointer",
            }}
          >
            <RefreshCw size={13} strokeWidth={2} />
            {busy ?? "Apply changes"}
          </button>
          <button
            onClick={() => verification.length && approvePlan(verification)}
            disabled={!!busy || !verification.length}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: "var(--c-fs-sm)",
              fontWeight: 550 as const,
              padding: "5px 11px",
              borderRadius: "var(--c-radius)",
              background: busy ? "var(--c-surface-3)" : "var(--c-success)",
              color: busy ? "var(--c-text-muted)" : "var(--c-on-accent)",
              border: "none",
              cursor: busy ? "default" : "pointer",
            }}
          >
            <ShieldCheck size={13} strokeWidth={2} />
            Re-approve
          </button>
        </div>
      )}

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <FleetBoard stories={display} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {selected ? <AgentPane card={selected} preview={preview} /> : <EmptyAgent />}
        </div>
      </div>
    </div>
  );
}

/** Choose which model the Dev fleet runs on; capture a non-Claude key if needed. */
function FleetModelPicker() {
  const fleetProvider = useCadre((s) => s.fleetProvider);
  const setFleetProvider = useCadre((s) => s.setFleetProvider);
  const provider = getProvider(fleetProvider);
  const [hasKey, setHasKey] = useState(true);
  const [keyDraft, setKeyDraft] = useState("");

  useEffect(() => {
    let alive = true;
    if (provider.id === "claude") {
      setHasKey(true); // claude falls back to the settings/keychain Anthropic key
      return;
    }
    secretHas(provider.secretKey).then((h) => {
      if (alive) setHasKey(h);
    });
    return () => {
      alive = false;
    };
  }, [provider.id, provider.secretKey]);

  async function saveKey() {
    const v = keyDraft.trim();
    if (!v) return;
    await secretSet(provider.secretKey, v);
    setKeyDraft("");
    setHasKey(true);
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <Cpu size={13} strokeWidth={2} style={{ color: "var(--c-text-muted)" }} />
      <select
        value={fleetProvider}
        onChange={(e) => setFleetProvider(e.target.value)}
        title="Model the Dev fleet runs on"
        style={{
          background: "var(--c-surface-2)",
          color: "var(--c-text)",
          border: "1px solid var(--c-border)",
          borderRadius: "var(--c-radius-sm)",
          fontSize: "var(--c-fs-xs)",
          padding: "3px 6px",
          fontFamily: "var(--c-font-ui)",
          cursor: "pointer",
        }}
      >
        {Object.values(PROVIDERS).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {!hasKey && (
        <>
          <input
            type="password"
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveKey()}
            placeholder={`${provider.name} key`}
            style={{
              width: 130,
              background: "var(--c-surface-1)",
              border: "1px solid var(--c-warning)",
              borderRadius: "var(--c-radius-sm)",
              outline: "none",
              color: "var(--c-text)",
              fontSize: "var(--c-fs-xs)",
              fontFamily: "var(--c-font-mono)",
              padding: "3px 6px",
            }}
          />
          <button
            onClick={saveKey}
            style={{
              fontSize: "var(--c-fs-xs)",
              fontWeight: 550 as const,
              padding: "3px 9px",
              borderRadius: "var(--c-radius-sm)",
              background: "var(--c-accent)",
              color: "var(--c-on-accent)",
              border: "none",
              cursor: "pointer",
            }}
          >
            Save
          </button>
        </>
      )}
    </div>
  );
}

function AgentPane({ card, preview }: { card: StoryCard; preview: boolean }) {
  const dispatchStory = useCadre((s) => s.dispatchStory);
  const getStoryMarkdown = useCadre((s) => s.getStoryMarkdown);
  const busy = useCadre((s) => s.busy);
  const needsReplan = useCadre((s) => s.needsReplan);
  // Dispatch is paused while the plan is changed-but-not-re-approved (§5.1).
  const canDispatch = !preview && !busy && !needsReplan && (card.status === "Draft" || card.status === "Failed");
  const info = stateInfo(card.status);

  const reviewStory = useCadre((s) => s.reviewStory);
  const codeReview = useCadre((s) => s.codeReviews[card.id]);
  const reviewing = codeReview?.status === "reviewing";
  // The review fleet runs after the agent has produced code (a worktree exists).
  const canReview = !preview && !busy && !reviewing && (card.status === "InReview" || card.status === "Done" || card.status === "Failed");

  const log = useCadre((s) => s.logs[card.id] ?? "");
  const hasLog = log.length > 0;

  const [markdown, setMarkdown] = useState<string>("");
  const storyDocRef = useRef<HTMLDivElement>(null);
  function exportStory() {
    const el = storyDocRef.current?.querySelector(".cadre-doc");
    if (el) exportHtmlToPdf(`story-${card.id}`, el.innerHTML);
  }
  useEffect(() => {
    if (preview) return;
    let alive = true;
    setMarkdown("");
    getStoryMarkdown(card.epic, card.story).then((md) => {
      if (alive) setMarkdown(md);
    });
    return () => {
      alive = false;
    };
  }, [preview, card.epic, card.story, card.status, getStoryMarkdown]);

  // Default to the live Output once a dispatch has produced any; Story otherwise.
  // (Manual toggles below persist — deps only change on card switch / first output.)
  const [view, setView] = useState<"story" | "output">("story");
  useEffect(() => {
    setView(hasLog ? "output" : "story");
  }, [card.id, hasLog]);

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--c-space-2)",
          padding: "var(--c-space-2) var(--c-space-4)",
          borderBottom: "1px solid var(--c-border)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: "var(--c-fs-sm)",
            color: "var(--c-accent)",
            background: "var(--c-accent-subtle)",
            border: "1px solid var(--c-accent-ring)",
            borderRadius: "var(--c-radius-full)",
            padding: "2px 10px",
          }}
        >
          dev · story {card.id}
        </span>
        <span style={{ fontSize: "var(--c-fs-xs)", fontFamily: "var(--c-font-mono)", color: "var(--c-text-muted)" }}>
          claude · branch story/{card.id}
        </span>
        <div style={{ flex: 1 }} />
        {canDispatch && (
          <button
            onClick={() => dispatchStory(card.epic, card.story)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: "var(--c-fs-xs)",
              fontWeight: 550 as const,
              padding: "4px 10px",
              borderRadius: "var(--c-radius-sm)",
              background: "var(--c-accent)",
              color: "var(--c-on-accent)",
              border: "none",
              cursor: "pointer",
            }}
          >
            <Play size={12} strokeWidth={2.5} />
            Dispatch
          </button>
        )}
        {(canReview || reviewing) && (
          <button
            onClick={() => !reviewing && reviewStory(card.epic, card.story)}
            disabled={reviewing}
            title="Run the adversarial code-review fleet (diverse-lens agent loops)"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: "var(--c-fs-xs)",
              fontWeight: 550 as const,
              padding: "4px 10px",
              borderRadius: "var(--c-radius-sm)",
              background: "transparent",
              color: reviewing ? "var(--c-text-muted)" : "var(--c-text-secondary)",
              border: "1px solid var(--c-border-strong)",
              cursor: reviewing ? "default" : "pointer",
            }}
          >
            <Gavel size={12} strokeWidth={2} />
            {reviewing ? "Reviewing…" : "Review"}
          </button>
        )}
        {markdown && (
          <button
            onClick={exportStory}
            title="Export the story to PDF"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: "var(--c-fs-xs)",
              color: "var(--c-text-secondary)",
              background: "transparent",
              border: "1px solid var(--c-border)",
              borderRadius: "var(--c-radius-sm)",
              padding: "3px 8px",
              cursor: "pointer",
            }}
          >
            <FileDown size={12} strokeWidth={2} /> PDF
          </button>
        )}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: "var(--c-fs-xs)",
            color: info.live ? info.color : "var(--c-text-muted)",
          }}
        >
          <Circle size={7} fill="currentColor" strokeWidth={0} />
          {info.live ? "live" : "idle"}
        </span>
      </div>

      {/* Status strip — the engine, not the agent, decides Done. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "5px var(--c-space-4)",
          borderBottom: "1px solid var(--c-border)",
          fontSize: "var(--c-fs-xs)",
          color: info.color,
          background: "var(--c-surface-1)",
          flexShrink: 0,
        }}
      >
        <Circle size={7} fill="currentColor" strokeWidth={0} />
        {info.label}
        <div style={{ flex: 1 }} />
        {!preview && (
          <div style={{ display: "flex", gap: 2 }}>
            {(["story", "output"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  fontSize: "var(--c-fs-xs)",
                  fontWeight: 550 as const,
                  textTransform: "capitalize",
                  padding: "2px 9px",
                  borderRadius: "var(--c-radius-full)",
                  border: "1px solid transparent",
                  background: view === v ? "var(--c-surface-3)" : "transparent",
                  color: view === v ? "var(--c-text)" : "var(--c-text-muted)",
                  cursor: "pointer",
                }}
              >
                {v}
                {v === "output" && hasLog && info.live ? " ·live" : ""}
              </button>
            ))}
          </div>
        )}
      </div>

      {view === "output" ? (
        <LiveTerminal log={log} empty="No agent output yet — Dispatch to run the story." />
      ) : markdown ? (
        <div ref={storyDocRef} style={{ flex: 1, overflow: "auto", padding: "var(--c-space-5)" }}>
          <Markdown className="cadre-doc" content={markdown} />
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--c-text-faint)",
            fontSize: "var(--c-fs-sm)",
          }}
        >
          Loading story…
        </div>
      )}

      {codeReview?.status === "done" && codeReview.reviews && codeReview.reviews.length > 0 && (
        <CodeReviewPanel reviews={codeReview.reviews} />
      )}
    </>
  );
}

function reviewSevColor(sev: string): string {
  return sev === "blocker" ? "var(--c-danger)" : sev === "major" ? "var(--c-warning)" : "var(--c-text-muted)";
}

/** The code-review fleet's verdict + findings for a story (adversary agents, visible). */
function CodeReviewPanel({ reviews }: { reviews: LensReview[] }) {
  const agg = aggregateReviews(reviews);
  const blocked = agg.verdict === "block";
  return (
    <div
      style={{
        flexShrink: 0,
        borderTop: "1px solid var(--c-border)",
        background: "var(--c-surface-1)",
        maxHeight: 260,
        overflow: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          padding: "8px var(--c-space-4)",
          position: "sticky",
          top: 0,
          background: "var(--c-surface-1)",
          borderBottom: "1px solid var(--c-border)",
        }}
      >
        {blocked ? (
          <ShieldAlert size={15} strokeWidth={2} style={{ color: "var(--c-warning)", flexShrink: 0 }} />
        ) : (
          <ShieldCheck size={15} strokeWidth={2} style={{ color: "var(--c-success)", flexShrink: 0 }} />
        )}
        <span style={{ fontSize: "var(--c-fs-sm)", fontWeight: 600 as const, color: blocked ? "var(--c-warning)" : "var(--c-success)" }}>
          {blocked ? `Blocked · ${agg.findingCount} finding${agg.findingCount === 1 ? "" : "s"}` : "Accepted by the review fleet"}
        </span>
        <div style={{ flex: 1 }} />
        {reviews.map((r) => (
          <span
            key={r.lens}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: "var(--c-fs-xs)",
              color: r.verdict === "block" ? "var(--c-warning)" : "var(--c-success)",
            }}
          >
            <Circle size={6} fill="currentColor" strokeWidth={0} />
            {r.lens}
          </span>
        ))}
      </div>
      <div style={{ padding: "var(--c-space-3) var(--c-space-4)", display: "flex", flexDirection: "column", gap: 11 }}>
        {reviews.flatMap((r) =>
          r.findings.map((f, i) => (
            <div key={`${r.lens}-${i}`} style={{ display: "flex", gap: 8 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: reviewSevColor(f.severity), marginTop: 6, flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: "var(--c-fs-sm)", color: "var(--c-text)" }}>
                  <span style={{ textTransform: "uppercase", fontSize: 9, letterSpacing: "0.06em", color: reviewSevColor(f.severity), marginRight: 6, fontWeight: 600 as const }}>
                    {f.severity}
                  </span>
                  <span style={{ color: "var(--c-text-faint)", marginRight: 6 }}>{r.lens}</span>
                  {f.title}
                </div>
                <div style={{ fontSize: "var(--c-fs-sm)", color: "var(--c-text-muted)", lineHeight: 1.5 }}>{f.detail}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Strip ANSI escape sequences so the streamed PTY output reads cleanly.
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

/** The live agent + verification transcript, auto-scrolled to the tail. */
function LiveTerminal({ log, empty }: { log: string; empty: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  if (!log) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--c-text-faint)",
          fontSize: "var(--c-fs-sm)",
          background: "var(--c-code-bg)",
        }}
      >
        {empty}
      </div>
    );
  }
  return (
    <div
      ref={ref}
      style={{
        flex: 1,
        background: "var(--c-code-bg)",
        padding: "var(--c-space-3) var(--c-space-4)",
        fontFamily: "var(--c-font-mono)",
        fontSize: "var(--c-fs-base)",
        lineHeight: 1.6,
        color: "var(--c-text-secondary)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        overflow: "auto",
      }}
    >
      {stripAnsi(log)}
    </div>
  );
}


function EmptyAgent() {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--c-text-faint)",
        fontSize: "var(--c-fs-sm)",
      }}
    >
      Select a story to watch its agent.
    </div>
  );
}
