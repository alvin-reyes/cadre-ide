/**
 * AgentOrgChart — Fleet view as a live org-chart of running agents.
 *
 * The Orchestrator sits at the root; beneath it, one node per story that is
 * currently InProgress or InReview. Each agent node shows its role, story id,
 * live terminal output, and — for InReview agents — the FleetBoard review panel
 * as a child sub-node.
 *
 * ENGINE-OWNED INVARIANT: this view NEVER mutates story status. It only calls
 * dispatchReady() and reviewStory(). No drag, no status write.
 */

import { Circle, Play, Network } from "lucide-react";
import { useBmadStore } from "../stores/bmadStore";
import { useCadre } from "./useCadre";
import { stateInfo, LiveTerminal, FleetModelPicker } from "./agentShared";
import { rollupCounts } from "../lib/engine/kanban";
import { FleetBoard } from "./components/FleetBoard";
import type { StoryCard } from "../lib/engine/board";

// ── Pure helper — which stories are "running" (InProgress | InReview) ─────────
export function runningStories(cards: StoryCard[]): StoryCard[] {
  return cards.filter((c) => c.status === "InProgress" || c.status === "InReview");
}

// ── OrchestratorNode — root card ──────────────────────────────────────────────
function OrchestratorNode({
  stories,
  agentCount,
}: {
  stories: StoryCard[];
  agentCount: number;
}) {
  const counts = rollupCounts(stories);
  const parts: string[] = [];
  if (counts.inProgress > 0) parts.push(`${counts.inProgress} working`);
  if (counts.qa > 0) parts.push(`${counts.qa} in QA`);
  if (counts.completed > 0) parts.push(`${counts.completed} done`);
  if (counts.backlog > 0) parts.push(`${counts.backlog} queued`);
  const statusLine = parts.length > 0 ? parts.join(" · ") : "No stories loaded";

  return (
    <div
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--c-space-1)",
        background: "var(--c-surface-2)",
        border: "1.5px solid var(--c-accent-ring)",
        borderRadius: "var(--c-radius)",
        padding: "var(--c-space-3) var(--c-space-4)",
        minWidth: 220,
        maxWidth: 320,
        boxShadow: "0 0 0 3px color-mix(in srgb, var(--c-accent) 12%, transparent)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Network size={14} strokeWidth={2} style={{ color: "var(--c-accent)" }} />
        <span
          style={{
            fontSize: "var(--c-fs-sm)",
            fontWeight: 650 as const,
            color: "var(--c-text)",
            letterSpacing: "0.02em",
          }}
        >
          Orchestrator
        </span>
      </div>
      <span
        style={{
          fontSize: "var(--c-fs-xs)",
          color: "var(--c-text-muted)",
          textAlign: "center",
          lineHeight: 1.5,
        }}
      >
        {statusLine}
      </span>
      {agentCount > 0 && (
        <span
          style={{
            fontSize: "9px",
            fontWeight: 600 as const,
            padding: "1px 6px",
            borderRadius: "var(--c-radius-full)",
            background: "color-mix(in srgb, var(--c-accent) 15%, transparent)",
            color: "var(--c-accent)",
            border: "1px solid color-mix(in srgb, var(--c-accent) 30%, transparent)",
          }}
        >
          {agentCount} agent{agentCount === 1 ? "" : "s"} active
        </span>
      )}
    </div>
  );
}

// ── AgentNode — one running agent ─────────────────────────────────────────────
function AgentNode({ card }: { card: StoryCard }) {
  const log = useCadre((s) => s.logs[card.id] ?? "");
  const codeReview = useCadre((s) => s.codeReviews[card.id]);

  const info = stateInfo(card.status);
  const isInReview = card.status === "InReview";
  const roleLabel = isInReview ? "QA / Review" : "Dev Agent";

  // Parse [phase] chip from title
  const phaseMatch = card.title?.match(/^\[([^\]]+)\]\s*(.*)/);
  const phaseChip = phaseMatch?.[1];
  const displayTitle = phaseMatch ? phaseMatch[2] : (card.title || "(untitled)");

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 0,
      }}
    >
      {/* Vertical line up from node to the horizontal bar */}
      <div
        style={{
          width: 1,
          height: 24,
          background: "var(--c-border-strong)",
          flexShrink: 0,
        }}
      />

      {/* The agent card */}
      <div
        style={{
          background: "var(--c-surface-1)",
          border: `1.5px solid ${isInReview ? "color-mix(in srgb, var(--c-warning) 60%, var(--c-border))" : "var(--c-border-strong)"}`,
          borderRadius: "var(--c-radius)",
          width: 280,
          overflow: "hidden",
          boxShadow: info.live
            ? `0 0 0 2px color-mix(in srgb, ${isInReview ? "var(--c-warning)" : "var(--c-accent)"} 18%, transparent)`
            : undefined,
        }}
      >
        {/* Node header */}
        <div
          style={{
            padding: "var(--c-space-2) var(--c-space-3)",
            background: isInReview
              ? "color-mix(in srgb, var(--c-warning) 8%, var(--c-surface-2))"
              : "color-mix(in srgb, var(--c-accent) 6%, var(--c-surface-2))",
            borderBottom: "1px solid var(--c-border)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--c-space-1)",
          }}
        >
          {/* Role badge */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                fontSize: "9px",
                fontWeight: 700 as const,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: isInReview ? "var(--c-warning)" : "var(--c-accent)",
                background: isInReview
                  ? "color-mix(in srgb, var(--c-warning) 15%, transparent)"
                  : "color-mix(in srgb, var(--c-accent) 15%, transparent)",
                border: `1px solid ${isInReview ? "color-mix(in srgb, var(--c-warning) 35%, transparent)" : "color-mix(in srgb, var(--c-accent) 35%, transparent)"}`,
                borderRadius: "var(--c-radius-full)",
                padding: "1px 7px",
              }}
            >
              {roleLabel}
            </span>

            {/* Live pulse */}
            {info.live && (
              <Circle
                size={7}
                fill={info.color}
                strokeWidth={0}
                className="cadre-typing-dot"
                style={{ color: info.color, flexShrink: 0 }}
              />
            )}

            {/* Status label */}
            <span
              style={{
                fontSize: "var(--c-fs-xs)",
                color: info.color,
                fontWeight: 500 as const,
              }}
            >
              {info.label}
            </span>
          </div>

          {/* Story id + title */}
          <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
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
            {phaseChip && (
              <span
                style={{
                  fontSize: "9px",
                  fontWeight: 600 as const,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  padding: "1px 5px",
                  borderRadius: "var(--c-radius-sm)",
                  background: "var(--c-surface-3)",
                  color: "var(--c-text-muted)",
                  whiteSpace: "nowrap",
                }}
              >
                {phaseChip}
              </span>
            )}
            <span
              style={{
                fontSize: "var(--c-fs-xs)",
                color: "var(--c-text-secondary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
                minWidth: 0,
              }}
            >
              {displayTitle}
            </span>
          </div>
        </div>

        {/* Live terminal output */}
        <div style={{ padding: "var(--c-space-2) var(--c-space-3)" }}>
          <LiveTerminal log={log} empty="Waiting for the agent…" />
        </div>
      </div>

      {/* For InReview agents — render the FleetBoard review panel as a child sub-node */}
      {isInReview && codeReview && (
        <>
          {/* Connector from agent card to review sub-node */}
          <div
            style={{
              width: 1,
              height: 20,
              background: "var(--c-border-strong)",
              flexShrink: 0,
            }}
          />
          <div
            style={{
              background: "var(--c-surface-1)",
              border: "1px solid color-mix(in srgb, var(--c-warning) 40%, var(--c-border))",
              borderRadius: "var(--c-radius)",
              overflow: "hidden",
              maxWidth: 280,
              width: "100%",
            }}
          >
            <div
              style={{
                fontSize: "9px",
                fontWeight: 700 as const,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--c-text-muted)",
                padding: "var(--c-space-1) var(--c-space-3)",
                background: "var(--c-surface-2)",
                borderBottom: "1px solid var(--c-border)",
              }}
            >
              Review findings
            </div>
            <div style={{ overflow: "hidden" }}>
              <FleetBoard
                stories={[card]}
                selectedId={card.id}
                onSelect={() => {}}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── AgentOrgChart ─────────────────────────────────────────────────────────────
export function AgentOrgChart() {
  const stories = useBmadStore((s) => s.stories);
  const dispatchReady = useCadre((s) => s.dispatchReady);
  const busy = useCadre((s) => s.busy);
  const preview = !useBmadStore((s) => s.projectRoot);

  const running = runningStories(stories);
  const counts = rollupCounts(stories);

  // Determine how many stories are ready-to-dispatch (Approved or Failed)
  const readyCount = stories.filter(
    (c) => c.status === "Approved" || c.status === "Failed"
  ).length;
  const canAutoExecute = !preview && !busy && readyCount > 0;

  // Idle: no running agents
  const idle = running.length === 0;

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
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
        <Network size={14} strokeWidth={2} style={{ color: "var(--c-text-muted)" }} />
        <span
          style={{
            fontSize: "var(--c-fs-sm)",
            fontWeight: 600 as const,
            color: "var(--c-text)",
          }}
        >
          Fleet
        </span>

        <span
          style={{
            fontSize: "var(--c-fs-xs)",
            color: "var(--c-text-faint)",
          }}
        >
          Live agent org-chart
        </span>

        {/* Auto-execute */}
        <button
          onClick={() => void dispatchReady()}
          disabled={!canAutoExecute}
          title={
            preview
              ? "Open a project to auto-execute"
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
            background: canAutoExecute ? "var(--c-accent)" : "var(--c-surface-3)",
            color: canAutoExecute ? "var(--c-on-accent)" : "var(--c-text-muted)",
            border: "none",
            cursor: canAutoExecute ? "pointer" : "default",
          }}
        >
          <Play size={13} strokeWidth={2.5} />
          Auto-execute{readyCount > 0 ? ` (${readyCount})` : ""}
        </button>

        {/* Status indicator */}
        {busy && (
          <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-accent)" }}>
            {busy}
          </span>
        )}
        {preview && !busy && (
          <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)" }}>
            Preview — open a project to use the org-chart.
          </span>
        )}

        <div style={{ flex: 1 }} />

        {/* Fleet model picker */}
        <FleetModelPicker />
      </div>

      {/* ── Chart body ── */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "var(--c-space-5) var(--c-space-4)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          minHeight: 0,
        }}
      >
        {/* Orchestrator root node */}
        <OrchestratorNode stories={stories} agentCount={running.length} />

        {idle ? (
          /* ── Idle state — no running agents ── */
          <div
            style={{
              marginTop: "var(--c-space-5)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "var(--c-space-2)",
            }}
          >
            {/* Short connector */}
            <div
              style={{
                width: 1,
                height: 32,
                background: "var(--c-border)",
              }}
            />
            <div
              style={{
                background: "var(--c-surface-2)",
                border: "1px dashed var(--c-border-strong)",
                borderRadius: "var(--c-radius)",
                padding: "var(--c-space-4) var(--c-space-5)",
                textAlign: "center",
                maxWidth: 340,
              }}
            >
              <div
                style={{
                  fontSize: "var(--c-fs-sm)",
                  color: "var(--c-text-secondary)",
                  fontWeight: 500 as const,
                  marginBottom: "var(--c-space-2)",
                }}
              >
                No agents running
              </div>
              <div
                style={{
                  fontSize: "var(--c-fs-xs)",
                  color: "var(--c-text-muted)",
                  lineHeight: 1.6,
                }}
              >
                {preview
                  ? "Open a project to see the agent org-chart."
                  : counts.backlog > 0
                    ? `${counts.backlog} stor${counts.backlog === 1 ? "y" : "ies"} waiting in the backlog${counts.completed > 0 ? ` · ${counts.completed} done` : ""}. Dispatch from the Shard tab or hit Auto-execute.`
                    : counts.completed > 0
                      ? `All ${counts.completed} stor${counts.completed === 1 ? "y" : "ies"} done — nothing left to run.`
                      : "No stories yet. Shard the backlog to get started."}
              </div>
            </div>
          </div>
        ) : (
          /* ── Org-chart: connector + agent nodes ── */
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              width: "100%",
            }}
          >
            {/* Vertical stem from root down to horizontal bar */}
            <div
              style={{
                width: 1,
                height: 24,
                background: "var(--c-border-strong)",
                flexShrink: 0,
              }}
            />

            {/* Horizontal bar spanning all children */}
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                position: "relative",
                width: "100%",
                justifyContent: "center",
              }}
            >
              {/* The horizontal connector bar — sits between vertical stem and children */}
              {running.length > 1 && (
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: "50%",
                    right: "50%",
                    // We'll use the pseudo approach via an inner element instead
                    height: 1,
                    background: "var(--c-border-strong)",
                    // Stretch it across all children: use a wrapper approach
                  }}
                />
              )}

              {/* Agent nodes row */}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  justifyContent: "center",
                  gap: "var(--c-space-4)",
                  position: "relative",
                }}
              >
                {/* Horizontal bar above the nodes */}
                {running.length > 1 && (
                  <div
                    aria-hidden
                    style={{
                      position: "absolute",
                      top: 0,
                      left: "calc(280px / 2)", // half the node width
                      right: "calc(280px / 2)",
                      height: 1,
                      background: "var(--c-border-strong)",
                      pointerEvents: "none",
                    }}
                  />
                )}

                {running.map((card) => (
                  <AgentNode key={card.id} card={card} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
