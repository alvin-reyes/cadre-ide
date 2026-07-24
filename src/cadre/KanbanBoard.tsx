/**
 * KanbanBoard — engine-driven Kanban visualization for Cadre.
 *
 * The board is a PURE VISUALIZATION of engine state. Cards flow between columns
 * automatically as the engine updates story status. The board NEVER calls
 * set-status directly — it only triggers dispatch actions. Movement to
 * QA/Completed is impossible by human action; only the engine can move a card
 * there when verification passes.
 *
 * Columns: Backlog | In Progress | QA | Completed
 * Swimlanes: one horizontal lane per epic; unmatched stories fall into "Other".
 */

import { useState, useEffect } from "react";
import {
  Plus,
  Play,
  ScrollText,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Loader2,
  Gavel,
} from "lucide-react";
import { useBmadStore } from "../stores/bmadStore";
import { useCadre, isInterrupted } from "./useCadre";
import { useRepos } from "../stores/reposStore";
import { parseEpics } from "../lib/planning/epics";
import { parseDefinitionOfDone } from "../lib/engine/shard";
import { KANBAN_COLUMNS, statusColumn, isAttention, rollupCounts, groupIntoLanes } from "../lib/engine/kanban";
import { FleetBoard } from "./components/FleetBoard";
import { StatusPill } from "./components/StatusPill";
import { stateInfo, LiveTerminal } from "./agentShared";
import type { StoryCard } from "../lib/engine/board";
import type { Epic } from "../lib/planning/epics";

// ── RollupPill — compact count badge ─────────────────────────────────────────
function RollupPill({
  count,
  label,
  variant,
}: {
  count: number;
  label: string;
  variant: "done" | "active" | "qa" | "backlog";
}) {
  if (count === 0) return null;
  const styles: Record<string, { bg: string; color: string; border: string }> = {
    done: {
      bg: "color-mix(in srgb, var(--c-success) 15%, transparent)",
      color: "var(--c-success)",
      border: "1px solid color-mix(in srgb, var(--c-success) 30%, transparent)",
    },
    active: {
      bg: "color-mix(in srgb, var(--c-accent) 15%, transparent)",
      color: "var(--c-accent)",
      border: "1px solid color-mix(in srgb, var(--c-accent) 30%, transparent)",
    },
    qa: {
      bg: "color-mix(in srgb, var(--c-warning) 15%, transparent)",
      color: "var(--c-warning)",
      border: "1px solid color-mix(in srgb, var(--c-warning) 30%, transparent)",
    },
    backlog: {
      bg: "var(--c-surface-3)",
      color: "var(--c-text-muted)",
      border: "1px solid var(--c-border)",
    },
  };
  const s = styles[variant];
  return (
    <span
      style={{
        fontSize: "9px",
        fontWeight: 600 as const,
        padding: "1px 5px",
        borderRadius: "var(--c-radius-sm)",
        background: s.bg,
        color: s.color,
        border: s.border,
      }}
    >
      {count} {label}
    </span>
  );
}

// ── KanbanCard — individual story card ────────────────────────────────────────
function KanbanCard({ card, preview }: { card: StoryCard; preview: boolean }) {
  const dispatchStory = useCadre((s) => s.dispatchStory);
  const getStoryMarkdown = useCadre((s) => s.getStoryMarkdown);
  const busy = useCadre((s) => s.busy);
  const active = useCadre((s) => s.active);
  const log = useCadre((s) => s.logs[card.id] ?? "");
  const needsReplan = useCadre((s) => s.needsReplan);

  const [expanded, setExpanded] = useState(false);
  const [dod, setDod] = useState<string[]>([]);
  const [dodState, setDodState] = useState<"idle" | "loading" | "loaded">("idle");

  const attention = isAttention(card.status);
  const info = stateInfo(card.status);
  const live = card.status === "InProgress" || card.status === "InReview";
  const interrupted = isInterrupted(card.status, active, card.epic, card.story);

  // Per-card execute: Approved | Failed | Blocked
  const canDispatch =
    !preview &&
    !busy &&
    !needsReplan &&
    (card.status === "Approved" || card.status === "Failed" || card.status === "Blocked");

  const canResume = !preview && !busy && !needsReplan && interrupted;

  const canApprove =
    !preview &&
    !busy &&
    card.status === "Draft";

  const codeReview = useCadre((s) => s.codeReviews[card.id]);
  const canReview =
    !preview &&
    !busy &&
    (card.status === "InReview" || card.status === "Done" || card.status === "Failed");

  // Reset DoD state when card changes (so we re-fetch on expand for the new card)
  useEffect(() => {
    setDod([]);
    setDodState("idle");
  }, [card.epic, card.story]);

  // Fetch DoD exactly once per card per expand — idle→loading→loaded (even for [])
  useEffect(() => {
    if (!expanded || preview || dodState !== "idle") return;
    setDodState("loading");
    let alive = true;
    getStoryMarkdown(card.epic, card.story).then((md) => {
      if (!alive) return;
      setDod(parseDefinitionOfDone(md));
      setDodState("loaded");
    });
    return () => { alive = false; };
  }, [expanded, preview, dodState, card.epic, card.story, getStoryMarkdown]);

  // Parse [phase] chip from title
  const phaseMatch = card.title?.match(/^\[([^\]]+)\]\s*(.*)/);
  const phaseChip = phaseMatch?.[1];
  const displayTitle = phaseMatch ? phaseMatch[2] : (card.title || "(untitled)");

  return (
    <div
      className={card.status === "InProgress" ? "cadre-generating" : undefined}
      style={{
        background: "var(--c-surface-1)",
        border: attention
          ? "1px solid var(--c-danger)"
          : "1px solid var(--c-border)",
        borderRadius: "var(--c-radius)",
        marginBottom: "var(--c-space-2)",
        overflow: "hidden",
        boxShadow: attention ? "0 0 0 2px var(--c-danger-subtle)" : undefined,
      }}
    >
      {/* Card header — click to expand */}
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse" : "Expand"} story ${card.id}`}
        className="cadre-hover"
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "var(--c-space-2)",
          width: "100%",
          textAlign: "left",
          padding: "var(--c-space-2) var(--c-space-3)",
          background: "transparent",
          border: "none",
          cursor: "pointer",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
            <span
              style={{
                fontSize: "var(--c-fs-xs)",
                fontFamily: "var(--c-font-mono)",
                color: "var(--c-text-muted)",
                flexShrink: 0,
              }}
            >
              {card.id}
            </span>
            {attention && (
              <AlertTriangle size={11} strokeWidth={2} style={{ color: "var(--c-danger)", flexShrink: 0 }} />
            )}
            {phaseChip && (
              <span
                className="cadre-label-mono"
                style={{
                  fontSize: "9px",
                  fontWeight: 600 as const,
                  padding: "1px 5px",
                  borderRadius: "var(--c-radius-sm)",
                  background: "var(--c-surface-3)",
                  whiteSpace: "nowrap",
                }}
              >
                {phaseChip}
              </span>
            )}
          </div>
          <div
            style={{
              fontSize: "var(--c-fs-sm)",
              color: "var(--c-text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {displayTitle}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
          <StatusPill status={card.status} interrupted={interrupted} />
          {expanded ? (
            <ChevronUp size={12} style={{ color: "var(--c-text-muted)" }} />
          ) : (
            <ChevronDown size={12} style={{ color: "var(--c-text-muted)" }} />
          )}
        </div>
      </button>

      {/* Per-card action buttons (visible without expanding) */}
      {(canApprove || canDispatch || canResume || canReview) && (
        <div
          style={{
            padding: "0 var(--c-space-3) var(--c-space-2)",
            display: "flex",
            gap: "var(--c-space-2)",
          }}
        >
          {canApprove && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                void useCadre.getState().approveStory(card.epic, card.story);
              }}
              title="Approve this draft story — it will become dispatchable"
              className="cadre-btn-primary"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: "var(--c-fs-xs)",
                fontWeight: 550 as const,
                padding: "3px 9px",
                borderRadius: "var(--c-radius-sm)",
                cursor: "pointer",
              }}
            >
              Approve
            </button>
          )}
          {canDispatch && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                void dispatchStory(card.epic, card.story);
              }}
              title={
                card.status === "Approved"
                  ? "Dispatch this story to a Dev agent"
                  : "Re-run this story (previous run failed or was blocked)"
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: "var(--c-fs-xs)",
                fontWeight: 550 as const,
                padding: "3px 9px",
                borderRadius: "var(--c-radius-sm)",
                background: attention ? "var(--c-danger-subtle)" : "var(--c-accent)",
                color: attention ? "var(--c-danger)" : "var(--c-on-accent)",
                border: attention ? "1px solid var(--c-danger)" : "none",
                cursor: "pointer",
              }}
            >
              <Play size={10} strokeWidth={2.5} />
              {card.status === "Approved" ? "Execute" : "Re-run"}
            </button>
          )}
          {canResume && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                void dispatchStory(card.epic, card.story);
              }}
              title="Resume — re-dispatches the interrupted run"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: "var(--c-fs-xs)",
                fontWeight: 550 as const,
                padding: "3px 9px",
                borderRadius: "var(--c-radius-sm)",
                background: "var(--c-warning-subtle)",
                color: "var(--c-warning)",
                border: "1px solid var(--c-warning)",
                cursor: "pointer",
              }}
            >
              <RefreshCw size={10} strokeWidth={2.5} />
              Resume
            </button>
          )}
          {canReview && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                void useCadre.getState().reviewStory(card.epic, card.story);
              }}
              title="Run the adversarial code-review fleet on this story"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: "var(--c-fs-xs)",
                fontWeight: 550 as const,
                padding: "3px 9px",
                borderRadius: "var(--c-radius-sm)",
                background: codeReview?.status === "reviewing" ? "var(--c-surface-3)" : "var(--c-surface-2)",
                color: codeReview?.status === "reviewing" ? "var(--c-text-muted)" : "var(--c-text)",
                border: "1px solid var(--c-border-strong)",
                cursor: codeReview?.status === "reviewing" ? "default" : "pointer",
              }}
            >
              <Gavel size={10} strokeWidth={2} />
              {codeReview?.status === "reviewing" ? "Reviewing…" : "Review"}
            </button>
          )}
        </div>
      )}

      {/* Expanded body: Definition of Done + live agent output */}
      {expanded && (
        <div
          style={{
            borderTop: "1px solid var(--c-border)",
            padding: "var(--c-space-3)",
            background: "var(--c-surface-2)",
          }}
        >
          {/* Status message */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontSize: "var(--c-fs-xs)",
              color: info.color,
              marginBottom: "var(--c-space-3)",
            }}
          >
            {/* Brand status dot — §5: success mint, in-progress violet pulsing, etc. */}
            <span
              className={
                card.status === "Done"
                  ? "cadre-dot cadre-dot-success"
                  : card.status === "InProgress"
                    ? "cadre-dot cadre-dot-progress"
                    : card.status === "InReview"
                      ? "cadre-dot cadre-dot-warning"
                      : interrupted
                        ? "cadre-dot cadre-dot-warning"
                        : "cadre-dot cadre-dot-muted"
              }
            />
            {interrupted
              ? "Interrupted — the run stopped when the app closed. Resume to re-dispatch."
              : info.label}
          </div>

          {/* Definition of Done checklist */}
          <div>
            <div
              style={{
                fontSize: "var(--c-fs-xs)",
                fontWeight: 600 as const,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--c-text-muted)",
                marginBottom: "var(--c-space-2)",
              }}
            >
              Definition of Done
            </div>
            {dodState === "loading" ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: "var(--c-fs-xs)",
                  color: "var(--c-text-muted)",
                }}
              >
                <Loader2 size={11} strokeWidth={2} className="cadre-spin" />
                Loading…
              </div>
            ) : dod.length === 0 ? (
              <div
                style={{
                  fontSize: "var(--c-fs-xs)",
                  color: "var(--c-text-muted)",
                  fontStyle: "italic",
                }}
              >
                {preview
                  ? "Open a project to view the Definition of Done."
                  : "No Definition of Done found in this story."}
              </div>
            ) : (
              <>
                <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                  {dod.map((item, i) => (
                    <li
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 6,
                        fontSize: "var(--c-fs-xs)",
                        color: "var(--c-text-secondary)",
                        lineHeight: 1.5,
                        marginBottom: 3,
                      }}
                    >
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 2,
                          border: "1.5px solid",
                          borderColor:
                            card.status === "Done"
                              ? "var(--c-success)"
                              : "var(--c-border-strong)",
                          background:
                            card.status === "Done"
                              ? "var(--c-success)"
                              : "transparent",
                          flexShrink: 0,
                          marginTop: 2,
                        }}
                      />
                      {item}
                    </li>
                  ))}
                </ul>
                <p
                  style={{
                    margin: "var(--c-space-1) 0 0",
                    fontSize: "var(--c-fs-xs)",
                    color: "var(--c-text-faint)",
                    fontStyle: "italic",
                  }}
                >
                  All items are shown as verified when the engine marks this story Done.
                </p>
              </>
            )}
          </div>

          {/* Live agent output — InProgress / InReview only */}
          {live && (
            <div style={{ marginTop: "var(--c-space-3)" }}>
              <div
                style={{
                  fontSize: "var(--c-fs-xs)",
                  fontWeight: 600 as const,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--c-text-muted)",
                  marginBottom: "var(--c-space-2)",
                }}
              >
                Agent Output
              </div>
              <LiveTerminal
                log={log}
                empty="No agent output yet — waiting for the agent to start."
              />
            </div>
          )}

          {/* Code-review panel — reuse FleetBoard for InReview/Done/Failed cards */}
          {canReview && codeReview && (
            <div style={{ marginTop: "var(--c-space-3)" }}>
              <div
                style={{
                  fontSize: "var(--c-fs-xs)",
                  fontWeight: 600 as const,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--c-text-muted)",
                  marginBottom: "var(--c-space-2)",
                }}
              >
                Code Review
              </div>
              {/* Wrap FleetBoard so it fits inline — override its fixed 232px width */}
              <div style={{ overflow: "hidden", borderRadius: "var(--c-radius)", border: "1px solid var(--c-border)", maxWidth: "100%" }}>
                <FleetBoard
                  stories={[card]}
                  selectedId={card.id}
                  onSelect={() => {}}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── EpicLane ──────────────────────────────────────────────────────────────────
function EpicLane({
  epic,
  cards,
  preview,
  onShard,
}: {
  epic: Epic | null;
  cards: StoryCard[];
  preview: boolean;
  onShard?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const busy = useCadre((s) => s.busy);

  // Only hide the "Other" catch-all when empty; named epic lanes always render
  // so you can shard into an empty epic via the "+ Shard story" button.
  if (cards.length === 0 && epic === null) return null;

  // Status rollup counts
  const counts = rollupCounts(cards);
  const doneCount = counts.completed;
  const inProgressCount = counts.inProgress;
  const qaCount = counts.qa;
  const backlogCount = counts.backlog;

  return (
    <div
      style={{
        marginBottom: "var(--c-space-4)",
        borderRadius: "var(--c-radius)",
        border: "1px solid var(--c-border)",
        overflow: "hidden",
      }}
    >
      {/* Collapsible lane header */}
      <div
        style={{
          padding: "var(--c-space-2) var(--c-space-3)",
          background: "var(--c-surface-2)",
          borderBottom: collapsed ? "none" : "1px solid var(--c-border)",
          display: "flex",
          alignItems: "center",
          gap: "var(--c-space-2)",
        }}
      >
        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand epic lane" : "Collapse epic lane"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 2,
            color: "var(--c-text-muted)",
            flexShrink: 0,
            transition: "transform 0.15s ease",
          }}
        >
          <ChevronDown
            size={14}
            strokeWidth={2}
            style={{
              transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
              transition: "transform 0.15s ease",
            }}
          />
        </button>

        {/* Epic label */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "var(--c-space-2)" }}>
          {epic ? (
            <>
              <span
                style={{
                  fontSize: "var(--c-fs-xs)",
                  fontWeight: 600 as const,
                  color: "var(--c-text-muted)",
                  flexShrink: 0,
                }}
              >
                Epic {epic.number}
              </span>
              <span
                style={{
                  fontSize: "var(--c-fs-xs)",
                  fontWeight: 600 as const,
                  color: "var(--c-text-secondary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {epic.title}
              </span>
            </>
          ) : (
            <span
              style={{
                fontSize: "var(--c-fs-xs)",
                fontWeight: 600 as const,
                color: "var(--c-text-muted)",
              }}
            >
              Other
            </span>
          )}

          {/* Task count */}
          <span
            style={{
              fontSize: "var(--c-fs-xs)",
              color: "var(--c-text-faint)",
              flexShrink: 0,
            }}
          >
            {cards.length} {cards.length === 1 ? "story" : "stories"}
          </span>

          {/* Status rollup pills */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <RollupPill count={doneCount} label="done" variant="done" />
            <RollupPill count={inProgressCount} label="active" variant="active" />
            <RollupPill count={qaCount} label="QA" variant="qa" />
            <RollupPill count={backlogCount} label="backlog" variant="backlog" />
          </div>
        </div>

        {/* Per-epic "+ Shard story" button — only for named epics */}
        {onShard && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onShard();
            }}
            disabled={preview || !!busy}
            title={
              preview
                ? "Open a project to shard stories"
                : `Shard the next story for Epic ${epic?.number ?? ""}`
            }
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: "var(--c-fs-xs)",
              fontWeight: 550 as const,
              padding: "3px 8px",
              borderRadius: "var(--c-radius-sm)",
              background:
                preview || busy ? "var(--c-surface-3)" : "var(--c-accent)",
              color:
                preview || busy ? "var(--c-text-muted)" : "var(--c-on-accent)",
              border: "none",
              cursor: preview || busy ? "default" : "pointer",
              flexShrink: 0,
            }}
          >
            <Plus size={11} strokeWidth={2.5} />
            Shard story
          </button>
        )}
      </div>

      {/* 4-column grid within this lane — hidden when collapsed */}
      {!collapsed && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
          }}
        >
          {KANBAN_COLUMNS.map((col, idx) => {
            const colCards = cards.filter((c) => statusColumn(c.status) === col.id);
            const colBg =
              col.id === "completed"
                ? "color-mix(in srgb, var(--c-success) 6%, transparent)"
                : col.id === "inProgress"
                  ? "color-mix(in srgb, var(--c-accent) 5%, transparent)"
                  : col.id === "qa"
                    ? "color-mix(in srgb, var(--c-warning) 5%, transparent)"
                    : undefined;
            return (
              <div
                key={col.id}
                style={{
                  padding: "var(--c-space-2)",
                  borderRight:
                    idx < KANBAN_COLUMNS.length - 1
                      ? "1px solid var(--c-border)"
                      : undefined,
                  minHeight: 60,
                  background: colBg,
                }}
              >
                {colCards.length === 0 ? (
                  <div
                    style={{
                      fontSize: "var(--c-fs-xs)",
                      color: "var(--c-text-faint)",
                      textAlign: "center",
                      paddingTop: "var(--c-space-3)",
                    }}
                  >
                    —
                  </div>
                ) : (
                  colCards.map((card) => (
                    <KanbanCard key={card.id} card={card} preview={preview} />
                  ))
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── KanbanBoard ────────────────────────────────────────────────────────────────
export function KanbanBoard() {
  const stories = useBmadStore((s) => s.stories);
  const projectRoot = useBmadStore((s) => s.projectRoot);
  const prd = useCadre((s) => s.prd);
  const epics = parseEpics(prd);

  const shardNextStory = useCadre((s) => s.shardNextStory);
  const shardBacklog = useCadre((s) => s.shardBacklog);
  const dispatchReady = useCadre((s) => s.dispatchReady);
  const busy = useCadre((s) => s.busy);
  const error = useCadre((s) => s.error);
  const needsReplan = useCadre((s) => s.needsReplan);
  const setPhase = useCadre((s) => s.setPhase);

  const repos = useRepos((s) => s.repos);
  const multiRepo = repos.length > 1;
  const [selectedRepo, setSelectedRepo] = useState(repos[0]?.id ?? "main");

  // Keep selectedRepo in sync if repos list changes
  useEffect(() => {
    if (multiRepo && !repos.find((r) => r.id === selectedRepo)) {
      setSelectedRepo(repos[0]?.id ?? "main");
    }
  }, [repos, selectedRepo, multiRepo]);

  const preview = !projectRoot;

  // Auto-execute: all Approved + Failed cards
  const readyCount = stories.filter(
    (c) => c.status === "Approved" || c.status === "Failed"
  ).length;
  const canAutoExecute = !preview && !busy && !needsReplan && readyCount > 0;

  // Group cards into epic swimlanes; unmatched → otherCards
  const { epicBuckets, otherCards } = groupIntoLanes(stories, epics);
  const epicMap = epicBuckets;

  // Fleet-wide rollup across ALL stories
  const fleetCounts = rollupCounts(stories);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>

      {/* ── Header toolbar ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--c-space-3)",
          padding: "var(--c-space-2) var(--c-space-4)",
          borderBottom: "1px solid var(--c-border)",
          flexShrink: 0,
          flexWrap: "wrap",
        }}
      >
        {/* Repo selector (multi-repo only) */}
        {multiRepo && (
          <select
            value={selectedRepo}
            onChange={(e) => setSelectedRepo(e.target.value)}
            title="Which repo to target for the next story"
            aria-label="Repo"
            style={{
              background: "var(--c-surface-2)",
              border: "1px solid var(--c-border-strong)",
              borderRadius: "var(--c-radius-sm)",
              color: "var(--c-text)",
              fontSize: "var(--c-fs-xs)",
              padding: "4px 6px",
              maxWidth: 150,
            }}
          >
            {repos.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name || r.id}
              </option>
            ))}
          </select>
        )}

        {/* Shard backlog */}
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
          Shard backlog
        </button>

        {/* Auto-execute — ONE primary action on this view */}
        <button
          onClick={() => dispatchReady()}
          disabled={!canAutoExecute}
          className={canAutoExecute ? "cadre-btn-primary" : undefined}
          title={
            preview
              ? "Open a project to auto-execute"
              : needsReplan
                ? "Re-approve the plan before dispatching — scope changed"
                : readyCount === 0
                  ? "No Approved or Failed stories ready to dispatch"
                  : `Dispatch all ${readyCount} ready stor${readyCount === 1 ? "y" : "ies"} in parallel`
          }
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: "var(--c-fs-sm)",
            fontWeight: 550 as const,
            padding: "5px 12px",
            borderRadius: "var(--c-radius)",
            background: canAutoExecute ? undefined : "var(--c-surface-3)",
            color: canAutoExecute ? undefined : "var(--c-text-muted)",
            border: "none",
            cursor: canAutoExecute ? "pointer" : "default",
          }}
        >
          <Play size={13} strokeWidth={2.5} />
          Auto-execute{readyCount > 0 ? ` (${readyCount})` : ""}
        </button>

        {/* Status / busy / error indicator */}
        <span
          style={{
            fontSize: "var(--c-fs-xs)",
            color: busy ? "var(--c-accent)" : error ? "var(--c-danger)" : "var(--c-text-muted)",
          }}
        >
          {busy ??
            error ??
            (preview
              ? "Preview — open a project to use the board."
              : `${stories.length} stor${stories.length === 1 ? "y" : "ies"}`)}
        </span>

        {/* Fleet-wide rollup strip */}
        {!preview && stories.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <RollupPill count={fleetCounts.completed} label="done" variant="done" />
            <RollupPill count={fleetCounts.inProgress} label="active" variant="active" />
            <RollupPill count={fleetCounts.qa} label="QA" variant="qa" />
            <RollupPill count={fleetCounts.backlog} label="backlog" variant="backlog" />
          </div>
        )}
      </div>

      {/* ── Engine-owned invariant caption ── */}
      <div
        style={{
          padding: "4px var(--c-space-4)",
          borderBottom: "1px solid var(--c-border)",
          background: "var(--c-surface-1)",
          flexShrink: 0,
          fontSize: "var(--c-fs-xs)",
          color: "var(--c-text-faint)",
          fontStyle: "italic",
        }}
      >
        Cards move when the engine verifies — you can&apos;t drag a task to Done.
      </div>

      {/* ── Replan banner — shown when the PRD changed after approval ── */}
      {needsReplan && (
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
          <AlertTriangle size={13} strokeWidth={2} style={{ color: "var(--c-warning)", flexShrink: 0 }} />
          <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-secondary)", flex: 1 }}>
            Scope changed since approval — dispatch is paused until the plan is re-approved.
          </span>
          <button
            onClick={() => setPhase("PLAN")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: "var(--c-fs-xs)",
              fontWeight: 550 as const,
              padding: "3px 9px",
              borderRadius: "var(--c-radius-sm)",
              background: "var(--c-surface-2)",
              color: "var(--c-text)",
              border: "1px solid var(--c-border-strong)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            Go to Planning
          </button>
        </div>
      )}

      {/* ── Column headers ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          borderBottom: "1px solid var(--c-border)",
          flexShrink: 0,
          background: "var(--c-surface-2)",
        }}
      >
        {KANBAN_COLUMNS.map((col, idx) => (
          <div
            key={col.id}
            style={{
              padding: "var(--c-space-2) var(--c-space-3)",
              borderRight:
                idx < KANBAN_COLUMNS.length - 1
                  ? "1px solid var(--c-border)"
                  : undefined,
              fontSize: "var(--c-fs-xs)",
              fontWeight: 600 as const,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--c-text-muted)",
            }}
          >
            {col.label}
          </div>
        ))}
      </div>

      {/* ── Board body: epic swimlanes ── */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "var(--c-space-3) var(--c-space-4)",
        }}
      >
        {stories.length === 0 && epics.length === 0 ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "var(--c-text-muted)",
              fontSize: "var(--c-fs-sm)",
              textAlign: "center",
              padding: "var(--c-space-5)",
            }}
          >
            {preview
              ? "Preview — open a project to view stories on the board."
              : "No stories yet. Use \"Shard story\" on an epic lane below, or \"Shard backlog\" to generate the full lifecycle backlog."}
          </div>
        ) : (
          <>
            {epics.map((ep) => (
              <EpicLane
                key={ep.number}
                epic={ep}
                cards={epicMap.get(ep.number) ?? []}
                preview={preview}
                onShard={() =>
                  shardNextStory(ep.number, multiRepo ? selectedRepo : undefined)
                }
              />
            ))}
            {otherCards.length > 0 && (
              <EpicLane epic={null} cards={otherCards} preview={preview} />
            )}
            {stories.length === 0 && epics.length > 0 && (
              <div
                style={{
                  textAlign: "center",
                  padding: "var(--c-space-4)",
                  color: "var(--c-text-faint)",
                  fontSize: "var(--c-fs-xs)",
                  fontStyle: "italic",
                }}
              >
                No stories yet — use &quot;Shard story&quot; on an epic above, or &quot;Shard backlog&quot; to generate the full lifecycle backlog.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
