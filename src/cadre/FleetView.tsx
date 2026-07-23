import { useState, useEffect, useRef } from "react";
import { Circle, Plus, Play, Cpu, MessageSquarePlus, AlertTriangle, RefreshCw, ShieldCheck, ShieldAlert, Gavel, FileDown, ArrowRight, ArrowLeft, Loader2, ScrollText } from "lucide-react";
import { FleetBoard } from "./components/FleetBoard";
import { StatusPill } from "./components/StatusPill";
import { Markdown } from "./components/Markdown";
import { exportHtmlToPdf } from "./exportPdf";
import { useBmadStore } from "../stores/bmadStore";
import { useCadre, isInterrupted } from "./useCadre";
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

export function FleetView({ mode = "fleet" }: { mode?: "shard" | "fleet" }) {
  const shard = mode === "shard";
  const stories = useBmadStore((s) => s.stories);
  const projectRoot = useBmadStore((s) => s.projectRoot);
  const shardNextStory = useCadre((s) => s.shardNextStory);
  const shardBacklog = useCadre((s) => s.shardBacklog);
  const dispatchReady = useCadre((s) => s.dispatchReady);
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
  // FLEET right pane: "activity" = the whole fleet at a glance; "task" = drill into
  // one agent's live run. SHARD always shows the task breakdown.
  const [rightView, setRightView] = useState<"activity" | "task">("activity");
  function openTask(id: string) {
    setSelectedId(id);
    setRightView("task");
  }

  // Fleet-state tally for the context band (working / queued / done / failed).
  const counts = { working: 0, queued: 0, done: 0, failed: 0 };
  for (const c of stories) {
    if (c.status === "InProgress" || c.status === "InReview") counts.working++;
    else if (c.status === "Done") counts.done++;
    else if (c.status === "Failed" || c.status === "Blocked") counts.failed++;
    else counts.queued++;
  }
  const allDone = stories.length > 0 && counts.done === stories.length;

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
        {shard && (
          <button
            onClick={() => shardBacklog(1)}
            disabled={preview || !!busy}
            title="Generate the COMPLETE lifecycle backlog — features, tests, deploy, monitoring, docs, support"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: "var(--c-fs-sm)",
              fontWeight: 550 as const,
              padding: "5px 12px",
              borderRadius: "var(--c-radius)",
              background: "transparent",
              color: preview || busy ? "var(--c-text-muted)" : "var(--c-text)",
              border: "1px solid var(--c-border-strong)",
              cursor: preview || busy ? "default" : "pointer",
            }}
          >
            <ScrollText size={14} strokeWidth={2} />
            Generate full backlog
          </button>
        )}
        {!shard && !preview && (() => {
          const readyCount = stories.filter((c) => c.status === "Approved" || c.status === "Failed").length;
          return (
            <button
              onClick={() => dispatchReady()}
              disabled={!!busy || readyCount === 0}
              title="Dispatch every ready story in parallel — file-disjoint stories run concurrently, sharing the Context Store"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: "var(--c-fs-sm)",
                fontWeight: 550 as const,
                padding: "5px 12px",
                borderRadius: "var(--c-radius)",
                background: busy || readyCount === 0 ? "var(--c-surface-3)" : "var(--c-accent)",
                color: busy || readyCount === 0 ? "var(--c-text-muted)" : "var(--c-on-accent)",
                border: "none",
                cursor: busy || readyCount === 0 ? "default" : "pointer",
              }}
            >
              <Play size={13} strokeWidth={2.5} />
              Dispatch ready{readyCount > 0 ? ` (${readyCount})` : ""}
            </button>
          );
        })()}
        <span style={{ fontSize: "var(--c-fs-xs)", color: busy ? "var(--c-accent)" : error ? "var(--c-danger)" : "var(--c-text-muted)" }}>
          {busy ??
            error ??
            (preview
              ? shard
                ? "Preview — open a project to shard stories."
                : "Preview — open a project to run the fleet."
              : shard
                ? `${stories.length} stor${stories.length === 1 ? "y" : "ies"} — review the breakdown, then go to Fleet to build`
                : `${stories.length} stor${stories.length === 1 ? "y" : "ies"}`)}
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
        {!preview && shard && stories.length > 0 && (
          <button
            onClick={() => setPhase("FLEET")}
            title="Happy with the breakdown? Go to Fleet to dispatch agents"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: "var(--c-fs-sm)",
              fontWeight: 550 as const,
              padding: "5px 12px",
              borderRadius: "var(--c-radius)",
              background: "var(--c-accent)",
              color: "var(--c-on-accent)",
              border: "none",
              cursor: "pointer",
            }}
          >
            Go to Fleet
            <ArrowRight size={14} strokeWidth={2.5} />
          </button>
        )}
        {!preview && !shard && <FleetModelPicker />}
      </div>

      {/* Context band — what this screen is for + live fleet state. */}
      {!preview && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "6px var(--c-space-4)",
            borderBottom: "1px solid var(--c-border)",
            background: "var(--c-surface-1)",
            flexShrink: 0,
            fontSize: "var(--c-fs-xs)",
          }}
        >
          {shard ? (
            <span style={{ color: "var(--c-text-muted)" }}>
              Break the approved plan into small, testable stories — review each below, then{" "}
              <b style={{ color: "var(--c-text-secondary)" }}>Go to Fleet</b> to build.
            </span>
          ) : (
            <>
              <Stat color="var(--c-accent)" label="working" n={counts.working} />
              <Stat color="var(--c-text-muted)" label="queued" n={counts.queued} />
              <Stat color="var(--c-success)" label="done" n={counts.done} />
              <Stat color="var(--c-danger)" label="failed" n={counts.failed} />
              <div style={{ flex: 1 }} />
              {allDone && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--c-success)", fontWeight: 550 as const }}>
                  <ShieldCheck size={12} strokeWidth={2} /> All tasks verified
                </span>
              )}
            </>
          )}
        </div>
      )}

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
            {busy ? <Loader2 size={13} strokeWidth={2.5} className="cadre-spin" /> : <RefreshCw size={13} strokeWidth={2} />}
            {busy ? "Applying…" : "Apply changes"}
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
        <FleetBoard
          stories={display}
          selectedId={rightView === "task" || shard ? selected?.id ?? null : null}
          onSelect={(id) => (shard ? setSelectedId(id) : openTask(id))}
        />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {shard ? (
            selected ? <AgentPane card={selected} preview={preview} mode="shard" /> : <EmptyAgent shard />
          ) : rightView === "activity" || !selected ? (
            <FleetActivity stories={display} preview={preview} onOpen={openTask} />
          ) : (
            <AgentPane card={selected} preview={preview} mode="fleet" onBack={() => setRightView("activity")} />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Fleet Activity — the whole agent fleet at a glance: who's working on what right
 * now (live output tail), plus queued and finished tasks. Click any task to drill
 * into its full agent monitor.
 */
function FleetActivity({
  stories,
  preview,
  onOpen,
}: {
  stories: StoryCard[];
  preview: boolean;
  onOpen: (id: string) => void;
}) {
  const logs = useCadre((s) => s.logs);
  const active = useCadre((s) => s.active);

  const working = stories.filter((c) => c.status === "InProgress" || c.status === "InReview");
  const rest = stories.filter((c) => c.status !== "InProgress" && c.status !== "InReview");

  if (stories.length === 0) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--c-text-muted)", fontSize: "var(--c-fs-sm)", textAlign: "center", padding: "var(--c-space-5)" }}>
        {preview ? "Preview — open a project to run the fleet." : "No stories yet. Shard the plan, then dispatch agents here."}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "var(--c-space-4)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: "var(--c-space-3)" }}>
        <span className={working.length ? "cadre-typing-dot" : undefined} style={{ display: "inline-flex", alignSelf: "center", color: working.length ? "var(--c-accent)" : "var(--c-text-faint)" }}>
          <Circle size={8} fill="currentColor" strokeWidth={0} />
        </span>
        <span style={{ fontSize: "var(--c-fs-sm)", fontWeight: 600 as const, color: "var(--c-text)" }}>
          {working.length ? `${working.length} agent${working.length === 1 ? "" : "s"} working` : "Fleet idle"}
        </span>
        <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)" }}>
          {working.length ? "· click a task to open its live monitor" : "· open a queued task below and Dispatch it"}
        </span>
      </div>

      {working.map((c) => (
        <ActivityTile key={c.id} card={c} log={logs[c.id] ?? ""} live={!!active[c.id]} onOpen={() => onOpen(c.id)} />
      ))}

      {rest.length > 0 && (
        <div style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--c-text-muted)", fontWeight: 600 as const, margin: `${working.length ? "var(--c-space-4)" : "0"} 0 var(--c-space-2)` }}>
          Not running
        </div>
      )}
      {rest.map((c) => {
        const info = stateInfo(c.status);
        return (
          <button
            key={c.id}
            onClick={() => onOpen(c.id)}
            aria-label={`Open task ${c.id} — ${c.status}`}
            className="cadre-hover"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              minHeight: 32,
              textAlign: "left",
              padding: "8px 10px",
              marginBottom: 6,
              borderRadius: "var(--c-radius)",
              background: "var(--c-surface-1)",
              border: "1px solid var(--c-border)",
              cursor: "pointer",
            }}
          >
            <Circle size={7} fill="currentColor" strokeWidth={0} style={{ color: info.color, flexShrink: 0 }} />
            <span style={{ fontSize: "var(--c-fs-xs)", fontFamily: "var(--c-font-mono)", color: "var(--c-text-muted)", flexShrink: 0 }}>{c.id}</span>
            <span style={{ fontSize: "var(--c-fs-sm)", color: "var(--c-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title || "(untitled)"}</span>
            <div style={{ flex: 1 }} />
            <StatusPill status={c.status} />
          </button>
        );
      })}
    </div>
  );
}

/** One live task card in the activity view: header + a tail of the agent's output. */
function ActivityTile({ card, log, live, onOpen }: { card: StoryCard; log: string; live: boolean; onOpen: () => void }) {
  const info = stateInfo(card.status);
  const tail = log ? log.split("\n").slice(-7).join("\n") : "";
  return (
    <button
      onClick={onOpen}
      aria-label={`Open live monitor for task ${card.id}`}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        marginBottom: "var(--c-space-3)",
        borderRadius: "var(--c-radius)",
        background: "var(--c-surface-1)",
        border: "1px solid var(--c-border-strong)",
        overflow: "hidden",
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px" }}>
        <span className={live ? "cadre-typing-dot" : undefined} style={{ display: "inline-flex", color: info.color }}>
          <Circle size={8} fill="currentColor" strokeWidth={0} />
        </span>
        <span style={{ fontSize: "var(--c-fs-xs)", fontFamily: "var(--c-font-mono)", color: "var(--c-text-muted)", flexShrink: 0 }}>{card.id}</span>
        <span style={{ fontSize: "var(--c-fs-sm)", fontWeight: 550 as const, color: "var(--c-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {card.title || "(untitled)"}
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: "var(--c-fs-xs)", color: info.color }}>{info.label}</span>
      </div>
      <pre
        style={{
          margin: 0,
          padding: "8px 10px",
          background: "var(--c-code-bg)",
          borderTop: "1px solid var(--c-border)",
          fontFamily: "var(--c-font-mono)",
          fontSize: "var(--c-fs-xs)",
          lineHeight: 1.5,
          color: "var(--c-text-secondary)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxHeight: 120,
          overflow: "hidden",
        }}
      >
        {tail || "waiting for output…"}
      </pre>
    </button>
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

function AgentPane({ card, preview, mode = "fleet", onBack }: { card: StoryCard; preview: boolean; mode?: "shard" | "fleet"; onBack?: () => void }) {
  const fleet = mode === "fleet";
  const dispatchStory = useCadre((s) => s.dispatchStory);
  const approveStory = useCadre((s) => s.approveStory);
  const getStoryMarkdown = useCadre((s) => s.getStoryMarkdown);
  const busy = useCadre((s) => s.busy);
  const needsReplan = useCadre((s) => s.needsReplan);
  const active = useCadre((s) => s.active);
  // An InProgress/InReview story that isn't running this session is orphaned — its
  // agent died with a prior app process. Offer Resume (dispatch is idempotent).
  const interrupted = isInterrupted(card.status, active, card.epic, card.story);
  // A freshly-sharded story is a Draft — the CTO reviews the breakdown and Approves
  // it before it can be dispatched to a Dev agent (BMAD story-review gate).
  const canApproveStory = !preview && !busy && card.status === "Draft";
  // Execution actions belong to FLEET; SHARD is for reviewing the breakdown.
  // Dispatch is paused while the plan is changed-but-not-re-approved (§5.1).
  const canDispatch = fleet && !preview && !busy && !needsReplan && (card.status === "Approved" || card.status === "Failed");
  const canResume = fleet && !preview && !busy && !needsReplan && interrupted;
  const info = interrupted
    ? { label: "Interrupted — the run stopped when the app closed. Resume to re-dispatch.", color: "var(--c-warning)", live: false }
    : stateInfo(card.status);

  const reviewStory = useCadre((s) => s.reviewStory);
  const codeReview = useCadre((s) => s.codeReviews[card.id]);
  const reviewing = codeReview?.status === "reviewing";
  // The review fleet runs after the agent has produced code (a worktree exists).
  const canReview = fleet && !preview && !busy && !reviewing && (card.status === "InReview" || card.status === "Done" || card.status === "Failed");

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

  // SHARD is about the breakdown → default to the Story. FLEET is execution →
  // default to live Output once a dispatch has produced any. (Manual toggles below
  // persist — deps only change on card switch / first output / mode.)
  const [view, setView] = useState<"story" | "output">("story");
  useEffect(() => {
    setView(fleet && hasLog ? "output" : "story");
  }, [card.id, hasLog, fleet]);

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
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Back to fleet activity"
            title="Back to fleet activity"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: "var(--c-fs-xs)",
              fontWeight: 550 as const,
              padding: "3px 8px",
              borderRadius: "var(--c-radius-sm)",
              background: "transparent",
              color: "var(--c-text-secondary)",
              border: "1px solid var(--c-border)",
              cursor: "pointer",
            }}
          >
            <ArrowLeft size={12} strokeWidth={2} />
            Activity
          </button>
        )}
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
        {fleet && (
          <span style={{ fontSize: "var(--c-fs-xs)", fontFamily: "var(--c-font-mono)", color: "var(--c-text-muted)" }}>
            claude · branch story/{card.id}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {canApproveStory && (
          <button
            onClick={() => approveStory(card.epic, card.story)}
            title="Review the breakdown, then approve this story for the fleet"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: "var(--c-fs-xs)",
              fontWeight: 550 as const,
              padding: "4px 10px",
              borderRadius: "var(--c-radius-sm)",
              background: "var(--c-success)",
              color: "var(--c-on-accent)",
              border: "none",
              cursor: "pointer",
            }}
          >
            <ShieldCheck size={12} strokeWidth={2.5} />
            Approve story
          </button>
        )}
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
        {canResume && (
          <button
            onClick={() => dispatchStory(card.epic, card.story)}
            title="Resume — clears the interrupted run's worktree and re-dispatches clean from HEAD"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: "var(--c-fs-xs)",
              fontWeight: 550 as const,
              padding: "4px 10px",
              borderRadius: "var(--c-radius-sm)",
              background: "var(--c-warning-subtle)",
              color: "var(--c-warning)",
              border: "1px solid var(--c-warning)",
              cursor: "pointer",
            }}
          >
            <RefreshCw size={12} strokeWidth={2.5} />
            Resume
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
        {!preview && fleet && (
          <div style={{ display: "flex", gap: 2 }}>
            {(["story", "output"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className="cadre-hover"
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


/** A colored count in the fleet context band. Dimmed when zero. */
function Stat({ color, label, n }: { color: string; label: string; n: number }) {
  const on = n > 0;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, opacity: on ? 1 : 0.5 }}>
      <Circle size={7} fill="currentColor" strokeWidth={0} style={{ color: on ? color : "var(--c-text-faint)" }} />
      <span style={{ color: "var(--c-text)", fontWeight: 600 as const }}>{n}</span>
      <span style={{ color: "var(--c-text-muted)" }}>{label}</span>
    </span>
  );
}

function EmptyAgent({ shard }: { shard?: boolean }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--c-text-muted)",
        fontSize: "var(--c-fs-sm)",
        textAlign: "center",
        padding: "var(--c-space-5)",
      }}
    >
      {shard
        ? "No stories yet — Generate story (SM) to break the plan into tasks."
        : "Select a task to watch its agent."}
    </div>
  );
}
