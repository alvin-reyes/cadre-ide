/**
 * TaskQueue — the Maintenance/Support intake panel.
 *
 * A prompt box that turns a plain-English request into a maintenance task
 * (`addMaintainTask`, which dispatches it into an isolated `task/<id>` worktree
 * via the engine), plus a live list of tasks grouped by status.
 *
 * Purely presentational apart from the single `addMaintainTask` call — no
 * dispatch logic lives here (the store owns orchestration).
 */

import { useState, type KeyboardEvent } from "react";
import { ListTodo, ArrowUp, Loader2 } from "lucide-react";
import { useCadre } from "../useCadre";
import type { MaintainTask, TaskStatus } from "../../lib/maintain/tasks";

// ── Status presentation ───────────────────────────────────────────────────────
interface StatusStyle {
  label: string;
  color: string;
  bg: string;
  border: string;
  dot: string;
}

function statusStyle(status: TaskStatus): StatusStyle {
  switch (status) {
    case "running":
      return {
        label: "Running",
        color: "var(--c-accent)",
        bg: "var(--c-accent-subtle)",
        border: "var(--c-accent-ring)",
        dot: "cadre-dot cadre-dot-progress",
      };
    case "verified":
      return {
        label: "Verified",
        color: "var(--c-success)",
        bg: "var(--c-success-subtle)",
        border: "color-mix(in srgb, var(--c-success) 40%, transparent)",
        dot: "cadre-dot cadre-dot-success",
      };
    case "failed":
      return {
        label: "Failed",
        color: "var(--c-warning)",
        bg: "var(--c-warning-subtle)",
        border: "color-mix(in srgb, var(--c-warning) 40%, transparent)",
        dot: "cadre-dot cadre-dot-warning",
      };
    case "queued":
    default:
      return {
        label: "Queued",
        color: "var(--c-text-muted)",
        bg: "var(--c-surface-3)",
        border: "var(--c-border)",
        dot: "cadre-dot cadre-dot-muted",
      };
  }
}

// Display order for the grouped sections — live work first, terminal states last.
const GROUP_ORDER: TaskStatus[] = ["running", "queued", "verified", "failed"];

function StatusPill({ status }: { status: TaskStatus }) {
  const s = statusStyle(status);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        flexShrink: 0,
        fontSize: "var(--c-fs-xs)",
        fontWeight: 600,
        color: s.color,
        background: s.bg,
        border: `1px solid ${s.border}`,
        borderRadius: "var(--c-radius-full)",
        padding: "1px 8px",
      }}
    >
      <span className={s.dot} />
      {s.label}
    </span>
  );
}

function TaskRow({ task }: { task: MaintainTask }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--c-space-2)",
        padding: "var(--c-space-3)",
        background: "var(--c-surface-2)",
        border: "1px solid var(--c-border)",
        borderRadius: "var(--c-radius-sm)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <span
          className="cadre-label-mono"
          style={{ fontSize: "9px", fontWeight: 700, color: "var(--c-text-faint)", letterSpacing: "0.04em" }}
        >
          #{task.id}
        </span>
        <span
          style={{
            fontSize: "var(--c-fs-sm)",
            color: "var(--c-text)",
            lineHeight: 1.45,
            wordBreak: "break-word",
          }}
        >
          {task.prompt}
        </span>
      </div>
      <StatusPill status={task.status} />
    </div>
  );
}

// ── TaskQueue ─────────────────────────────────────────────────────────────────
export function TaskQueue() {
  const tasks = useCadre((s) => s.tasks);
  const addMaintainTask = useCadre((s) => s.addMaintainTask);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);

  const trimmed = prompt.trim();
  const canSend = trimmed.length > 0 && !sending;

  async function send() {
    if (!canSend) return;
    const text = trimmed;
    setSending(true);
    setPrompt("");
    try {
      await addMaintainTask(text);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  const groups = GROUP_ORDER.map((status) => ({
    status,
    items: tasks.filter((t) => t.status === status),
  })).filter((g) => g.items.length > 0);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* ── Header toolbar (matches the Fleet toolbar) ── */}
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
        <ListTodo size={14} strokeWidth={2} style={{ color: "var(--c-text-muted)" }} />
        <span style={{ fontSize: "var(--c-fs-sm)", fontWeight: 600, color: "var(--c-text)" }}>Tasks</span>
        <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>
          Ad-hoc maintenance & support
        </span>
      </div>

      {/* ── Prompt intake ── */}
      <div
        style={{
          padding: "var(--c-space-3) var(--c-space-4)",
          borderBottom: "1px solid var(--c-border)",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--c-space-2)",
            background: "var(--c-surface-2)",
            border: "1px solid var(--c-border-strong)",
            borderRadius: "var(--c-radius)",
            padding: "var(--c-space-2)",
          }}
        >
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Describe a change or fix — e.g. “add a health-check endpoint to the API”"
            rows={3}
            style={{
              width: "100%",
              resize: "none",
              border: "none",
              outline: "none",
              background: "transparent",
              color: "var(--c-text)",
              fontFamily: "inherit",
              fontSize: "var(--c-fs-base)",
              lineHeight: 1.5,
            }}
          />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--c-space-2)" }}>
            <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>
              Runs in an isolated <code style={{ fontFamily: "var(--c-font-mono, monospace)" }}>task/&lt;id&gt;</code> worktree
            </span>
            <button
              onClick={() => void send()}
              disabled={!canSend}
              className={canSend ? "cadre-btn-primary" : undefined}
              title={canSend ? "Dispatch this task" : "Type a request to dispatch a task"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: "var(--c-fs-sm)",
                fontWeight: 550,
                padding: "5px 12px",
                borderRadius: "var(--c-radius)",
                border: "none",
                background: canSend ? undefined : "var(--c-surface-3)",
                color: canSend ? undefined : "var(--c-text-muted)",
                cursor: canSend ? "pointer" : "default",
              }}
            >
              {sending ? (
                <Loader2 size={13} strokeWidth={2.5} className="cadre-spin" />
              ) : (
                <ArrowUp size={13} strokeWidth={2.5} />
              )}
              Send
            </button>
          </div>
        </div>
      </div>

      {/* ── Task list ── */}
      <div style={{ flex: 1, overflow: "auto", padding: "var(--c-space-3) var(--c-space-4)", minHeight: 0 }}>
        {tasks.length === 0 ? (
          <div
            style={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "var(--c-space-2)",
              textAlign: "center",
              color: "var(--c-text-muted)",
            }}
          >
            <ListTodo size={22} strokeWidth={1.5} style={{ color: "var(--c-text-faint)" }} />
            <span style={{ fontSize: "var(--c-fs-sm)", fontWeight: 550, color: "var(--c-text-secondary)" }}>
              No tasks yet
            </span>
            <span style={{ fontSize: "var(--c-fs-xs)", maxWidth: 240, lineHeight: 1.5 }}>
              Describe a change above and the fleet will pick it up on its own branch.
            </span>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--c-space-4)" }}>
            {groups.map((g) => (
              <div key={g.status} style={{ display: "flex", flexDirection: "column", gap: "var(--c-space-2)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--c-space-2)" }}>
                  <span
                    className="cadre-label-mono"
                    style={{ fontSize: "9px", fontWeight: 700, color: "var(--c-text-muted)", letterSpacing: "0.06em" }}
                  >
                    {statusStyle(g.status).label}
                  </span>
                  <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>{g.items.length}</span>
                </div>
                {g.items.map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
