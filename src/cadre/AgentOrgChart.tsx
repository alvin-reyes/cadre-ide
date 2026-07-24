/**
 * AgentOrgChart — Fleet view as a live org-chart of running agents.
 *
 * The Orchestrator sits at the root; beneath it, one node per story that is
 * currently InProgress or InReview. Each agent node shows its role, story id,
 * live terminal output, and — for InReview agents — the FleetBoard review panel
 * as a child sub-node.
 *
 * ENGINE-OWNED INVARIANT: this view NEVER mutates story status. It only calls
 * dispatchReady(). No drag, no status write.
 */

import { Play, Network } from "lucide-react";
import { useBmadStore } from "../stores/bmadStore";
import { useCadre } from "./useCadre";
import { LiveTerminal } from "./agentShared";
import { rollupCounts } from "../lib/engine/kanban";
import { useSettingsStore } from "../stores/settingsStore";
import { agentLabel, composeRoster } from "../lib/engine/agentSlots";
import type { StoryCard } from "../lib/engine/board";
import type { AgentSlot } from "../lib/engine/projectSlices";

// ── OrchestratorNode — root card ──────────────────────────────────────────────
function OrchestratorNode({
  stories,
  agentCount,
  poolSummary,
}: {
  stories: StoryCard[];
  agentCount: number;
  poolSummary?: string;
}) {
  const counts = rollupCounts(stories);
  const parts: string[] = [];
  if (counts.inProgress > 0) parts.push(`${counts.inProgress} working`);
  if (counts.qa > 0) parts.push(`${counts.qa} in QA`);
  if (counts.completed > 0) parts.push(`${counts.completed} done`);
  if (counts.backlog > 0) parts.push(`${counts.backlog} queued`);
  const statusLine = poolSummary ?? (parts.length > 0 ? parts.join(" · ") : "No stories loaded");

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


// ── PoolAgentNode — one stable team-pool slot ─────────────────────────────────
function slotStatusInfo(status: AgentSlot["status"]): { label: string; color: string; live: boolean } {
  switch (status) {
    case "working":
      return { label: "Working", color: "var(--c-accent)", live: true };
    case "verifying":
      return { label: "Verifying", color: "var(--c-warning)", live: true };
    case "idle":
    default:
      return { label: "Idle", color: "var(--c-text-muted)", live: false };
  }
}

function PoolAgentNode({
  slot,
  log,
  stories,
}: {
  slot: AgentSlot;
  log: string;
  stories: StoryCard[];
}) {
  const info = slotStatusInfo(slot.status);
  const isWorking = slot.status === "working";
  const isVerifying = slot.status === "verifying";
  const isIdle = slot.status === "idle";

  // Look up story details if the slot has one assigned
  const story = slot.currentStory
    ? stories.find((s) => s.id === slot.currentStory)
    : null;

  const storyLabel = story
    ? `${story.epic}.${story.story} · ${story.title ?? slot.currentStory}`
    : null;

  const borderColor = isVerifying
    ? "color-mix(in srgb, var(--c-warning) 60%, var(--c-border))"
    : isWorking
      ? "color-mix(in srgb, var(--c-accent) 60%, var(--c-border))"
      : "var(--c-border-strong)";

  const headerBg = isVerifying
    ? "color-mix(in srgb, var(--c-warning) 8%, var(--c-surface-2))"
    : isWorking
      ? "color-mix(in srgb, var(--c-accent) 6%, var(--c-surface-2))"
      : "var(--c-surface-2)";

  const glowColor = isVerifying ? "var(--c-warning)" : "var(--c-accent)";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 0,
      }}
    >
      {/* Vertical line up */}
      <div
        style={{
          width: 1,
          height: 24,
          background: "var(--c-border-strong)",
          flexShrink: 0,
        }}
      />

      {/* The agent card — cadre-generating applied when actively working */}
      <div
        className={isWorking ? "cadre-generating" : undefined}
        style={{
          background: "var(--c-surface-1)",
          border: `1.5px solid ${borderColor}`,
          borderRadius: "var(--c-radius)",
          width: 280,
          overflow: "hidden",
          boxShadow:
            !isIdle
              ? `0 0 0 2px color-mix(in srgb, ${glowColor} 18%, transparent)`
              : undefined,
        }}
      >
        {/* Node header */}
        <div
          style={{
            padding: "var(--c-space-2) var(--c-space-3)",
            background: headerBg,
            borderBottom: "1px solid var(--c-border)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--c-space-1)",
          }}
        >
          {/* Agent name + status */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {/* Role badge — mono uppercase §5 */}
            <span
              className="cadre-label-mono"
              style={{
                fontSize: "9px",
                fontWeight: 700 as const,
                color: isIdle ? "var(--c-text-muted)" : isVerifying ? "var(--c-warning)" : "var(--c-accent)",
                background: isIdle
                  ? "var(--c-surface-3)"
                  : isVerifying
                    ? "color-mix(in srgb, var(--c-warning) 15%, transparent)"
                    : "color-mix(in srgb, var(--c-accent) 15%, transparent)",
                border: `1px solid ${isIdle ? "var(--c-border)" : isVerifying ? "color-mix(in srgb, var(--c-warning) 35%, transparent)" : "color-mix(in srgb, var(--c-accent) 35%, transparent)"}`,
                borderRadius: "var(--c-radius-full)",
                padding: "1px 7px",
              }}
            >
              {agentLabel(slot.agentId)}
            </span>

            {/* Live pulse — brand status dot §5 */}
            {info.live && (
              <span
                className={isVerifying ? "cadre-dot cadre-dot-warning" : "cadre-dot cadre-dot-progress"}
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

          {/* Current story */}
          {storyLabel && (
            <div
              style={{
                fontSize: "var(--c-fs-xs)",
                color: "var(--c-text-secondary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {storyLabel}
            </div>
          )}
        </div>

        {/* Live terminal output */}
        <div style={{ padding: "var(--c-space-2) var(--c-space-3)" }}>
          <LiveTerminal
            log={log}
            empty={isIdle ? "Idle — waiting for a task" : "Waiting for the agent…"}
          />
        </div>
      </div>
    </div>
  );
}

// ── AgentOrgChart ─────────────────────────────────────────────────────────────
export function AgentOrgChart() {
  const stories = useBmadStore((s) => s.stories);
  const dispatchReady = useCadre((s) => s.dispatchReady);
  const busy = useCadre((s) => s.busy);
  const preview = !useBmadStore((s) => s.projectRoot);

  // Role fleet state — the pool is always on
  const maxDevAgents = useSettingsStore((s) => s.maxDevAgents);
  const agentSlots = useCadre((s) => s.agentSlots);
  const agentLogs = useCadre((s) => s.agentLogs);

  // Determine how many stories are ready-to-dispatch (Approved or Failed)
  const readyCount = stories.filter(
    (c) => c.status === "Approved" || c.status === "Failed"
  ).length;
  const canAutoExecute = !preview && !busy && readyCount > 0;

  // Always render the role roster: use live agentSlots when populated,
  // fall back to a placeholder roster (composeRoster with no existing slots)
  // so QA + DevOps + Dev slots are visible even before the first dispatch.
  const slotsToRender: AgentSlot[] =
    agentSlots.length > 0
      ? agentSlots
      : composeRoster(maxDevAgents, []);

  // Tally for the Orchestrator node caption
  const qaSlot = slotsToRender.find((s) => s.role === "qa");
  const devopsSlot = slotsToRender.find((s) => s.role === "devops");
  const devSlots = slotsToRender.filter((s) => s.role === "dev");
  const workingDevCount = devSlots.filter(
    (s) => s.status === "working" || s.status === "verifying"
  ).length;

  const parts: string[] = [];
  if (qaSlot) parts.push("QA");
  if (devopsSlot) parts.push("DevOps");
  if (devSlots.length > 0) {
    parts.push(`${workingDevCount} Dev working`);
  }
  const poolSummary = parts.join(" · ") || "Fleet idle";

  const workingTotal = slotsToRender.filter(
    (s) => s.status === "working" || s.status === "verifying"
  ).length;

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

        {/* Auto-execute — ONE primary action on this view */}
        <button
          onClick={() => void dispatchReady()}
          disabled={!canAutoExecute}
          className={canAutoExecute ? "cadre-btn-primary" : undefined}
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
            background: canAutoExecute ? undefined : "var(--c-surface-3)",
            color: canAutoExecute ? undefined : "var(--c-text-muted)",
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
        {/* ── Role roster: QA · DevOps · Dev×N (always rendered) ── */}
        <>
          {/* Orchestrator root node */}
          <OrchestratorNode stories={stories} agentCount={workingTotal} poolSummary={poolSummary} />

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              width: "100%",
            }}
          >
            {/* Vertical stem */}
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
                {slotsToRender.length > 1 && (
                  <div
                    aria-hidden
                    style={{
                      position: "absolute",
                      top: 0,
                      left: "calc(280px / 2)",
                      right: "calc(280px / 2)",
                      height: 1,
                      background: "var(--c-border-strong)",
                      pointerEvents: "none",
                    }}
                  />
                )}

                {slotsToRender.map((slot) => (
                  <PoolAgentNode
                    key={slot.agentId}
                    slot={slot}
                    log={slot.status === "idle" ? "" : (agentLogs[slot.agentId] ?? "")}
                    stories={stories}
                  />
                ))}
              </div>
            </div>
          </div>

          {readyCount > 0 && agentSlots.length === 0 && (
            <div
              style={{
                marginTop: "var(--c-space-4)",
                fontSize: "var(--c-fs-xs)",
                color: "var(--c-text-muted)",
                textAlign: "center",
              }}
            >
              {readyCount} stor{readyCount === 1 ? "y" : "ies"} ready — hit Auto-execute to start the fleet.
            </div>
          )}
        </>
      </div>
    </div>
  );
}
