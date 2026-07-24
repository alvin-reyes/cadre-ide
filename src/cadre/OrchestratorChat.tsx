import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bot, X, ArrowUp, Plus, ScrollText, Play, PanelRight, Maximize2, Minimize2 } from "lucide-react";
import { planningTurn, type ChatMessage } from "../lib/planning/planningChat";
import { ORCHESTRATOR_SYSTEM_PROMPT } from "../lib/planning/personas";
import { SESSION_LOG_PATH, tailSessionLog } from "../lib/engine/sessionLog";
import { Markdown } from "./components/Markdown";
import { useCadre, MODEL } from "./useCadre";
import { useBmadStore } from "../stores/bmadStore";
import { reportError } from "../lib/reportError";
import { useSettingsStore } from "../stores/settingsStore";
import { resolvePlanningAuth } from "../lib/planning/planningAuth";
import { secretGet } from "../lib/secrets";
import type { StoryCard } from "../lib/engine/board";

/**
 * The floating Orchestrator — a project-management copilot reachable from anywhere,
 * with LIVE context of the whole fleet (plan + every story + status) injected into
 * each turn. The CTO chats to steer; quick actions add/dispatch work.
 */
function buildContext(phase: string, prd: string, architecture: string, stories: StoryCard[], journal: string): string {
  const lines: string[] = [];
  lines.push(`Current phase: ${phase}`);
  lines.push(`PRD: ${prd.trim() ? "written" : "not written"} · Architecture: ${architecture.trim() ? "written" : "not written"}`);
  if (stories.length === 0) {
    lines.push("Stories: none sharded yet.");
  } else {
    lines.push(`Stories (${stories.length}):`);
    for (const s of stories) lines.push(`- ${s.id} ${s.title ?? "(untitled)"} [${s.status}]`);
  }
  if (journal.trim()) {
    lines.push("");
    lines.push("## Session journal (what's been planned, built, shipped)");
    lines.push(tailSessionLog(journal, 40).trim());
  }
  return lines.join("\n");
}

type PanelMode = "float" | "side" | "max";

export function OrchestratorChat() {
  const [open, setOpen] = useState(false);
  // How the panel is laid out: floating bubble, docked full-height side panel, or maximized.
  const [mode, setMode] = useState<PanelMode>("float");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);

  const anthropicKey = useSettingsStore((s) => s.anthropicApiKey);
  const authProvider = useSettingsStore((s) => s.authProvider);
  const dispatchUseLogin = useSettingsStore((s) => s.dispatchUseLogin);
  const model = useSettingsStore((s) => s.planningModel) || MODEL;

  // Resolved planning auth — drives the send gate and shows the not-ready reason.
  const [planAuth, setPlanAuth] = useState<{ ready: boolean; apiKey: string; baseUrl?: string; reason?: string }>({ ready: false, apiKey: "" });
  useEffect(() => {
    resolvePlanningAuth(authProvider, dispatchUseLogin, secretGet).then((a) =>
      setPlanAuth({ ready: a.ready, apiKey: a.apiKey, baseUrl: a.baseUrl, reason: a.reason })
    );
  }, [authProvider, dispatchUseLogin, anthropicKey]);
  const phase = useCadre((s) => s.phase);
  const prd = useCadre((s) => s.prd);
  const architecture = useCadre((s) => s.architecture);
  const busy = useCadre((s) => s.busy);
  const stories = useBmadStore((s) => s.stories);
  const shardNextStory = useCadre((s) => s.shardNextStory);
  const shardBacklog = useCadre((s) => s.shardBacklog);
  const dispatchReady = useCadre((s) => s.dispatchReady);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const counts = { done: 0, building: 0, blocked: 0, approved: 0, draft: 0 };
  for (const s of stories) {
    if (s.status === "Done") counts.done++;
    else if (s.status === "InProgress" || s.status === "InReview") counts.building++;
    else if (s.status === "Blocked" || s.status === "Failed") counts.blocked++;
    else if (s.status === "Approved") counts.approved++;
    else counts.draft++;
  }

  async function send(text: string) {
    const t = text.trim();
    if (!t || thinking || !planAuth.ready) return;
    const auth = await resolvePlanningAuth(authProvider, dispatchUseLogin, secretGet);
    if (!auth.ready) { reportError("orchestrator", new Error(auth.reason ?? "planning credential missing")); return; }
    const base: ChatMessage[] = [...messages, { role: "user", content: t }];
    setMessages([...base, { role: "assistant", content: "" }]);
    setDraft("");
    setThinking(true);
    // Pull the persisted session journal so the Orchestrator knows what's been built.
    const root = useBmadStore.getState().projectRoot;
    const journal = root
      ? await invoke<string>("read_file", { path: `${root}/${SESSION_LOG_PATH}` }).catch(() => "")
      : "";
    const ctx = buildContext(phase, prd, architecture, stories, journal);
    let acc = "";
    const setLast = (content: string) =>
      setMessages((m) => {
        const a = m.slice();
        a[a.length - 1] = { role: "assistant", content };
        return a;
      });
    try {
      const res = await planningTurn({
        apiKey: auth.apiKey,
        baseUrl: auth.baseUrl,
        model,
        systemPrompt: `${ORCHESTRATOR_SYSTEM_PROMPT}\n\n## Live project state\n${ctx}`,
        messages: base,
        allowMockup: false,
        allowVerification: false,
        allowHandoff: false,
        onText: (d) => {
          acc += d;
          setLast(acc);
        },
      });
      setLast((res.reply || acc).trim() || "(no reply)");
    } catch (e) {
      setLast(`Error: ${String(e)}`);
      reportError("orchestrator", e);
    } finally {
      setThinking(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(draft);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Orchestrator — project copilot"
        aria-label="Open the Orchestrator copilot"
        style={{
          position: "fixed",
          bottom: 18,
          right: 18,
          zIndex: 850,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 46,
          height: 46,
          borderRadius: "50%",
          background: "var(--c-accent)",
          color: "var(--c-on-accent)",
          border: "none",
          boxShadow: "var(--c-elev-2)",
          cursor: "pointer",
        }}
      >
        <Bot size={22} strokeWidth={2} />
      </button>
    );
  }

  const action = (fn: () => void, label: string, Icon: typeof Plus) => (
    <button
      onClick={fn}
      disabled={!!busy || !planAuth.ready}
      className="cadre-chip"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: "var(--c-fs-xs)",
        color: busy || !planAuth.ready ? "var(--c-text-muted)" : "var(--c-accent)",
        background: "var(--c-accent-subtle)",
        border: "1px solid var(--c-accent-ring)",
        borderRadius: "var(--c-radius-full)",
        padding: "3px 9px",
        cursor: busy || !planAuth.ready ? "default" : "pointer",
      }}
    >
      <Icon size={11} strokeWidth={2} />
      {label}
    </button>
  );

  const layout: React.CSSProperties =
    mode === "float"
      ? { bottom: 18, right: 18, width: 400, maxWidth: "calc(100vw - 36px)", height: 560, maxHeight: "calc(100vh - 90px)", borderRadius: "var(--c-radius-lg)" }
      : mode === "side"
        ? { top: 0, right: 0, bottom: 0, width: 460, maxWidth: "100vw", borderRadius: 0 }
        : { top: 20, right: 20, bottom: 20, left: 20, borderRadius: "var(--c-radius-lg)" };

  const headBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: "var(--c-radius-sm)", background: "transparent", border: "none", color: "var(--c-text-muted)", cursor: "pointer" };

  return (
    <div
      className="cadre-bubble"
      style={{
        position: "fixed",
        zIndex: 850,
        display: "flex",
        flexDirection: "column",
        background: "var(--c-surface-1)",
        border: "1px solid var(--c-border-strong)",
        boxShadow: "var(--c-elev-3)",
        overflow: "hidden",
        ...layout,
      }}
    >
      {/* Header + live overview */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px var(--c-space-3)", borderBottom: "1px solid var(--c-border)" }}>
        <Bot size={16} strokeWidth={2} style={{ color: "var(--c-accent)" }} />
        <span style={{ fontSize: "var(--c-fs-sm)", fontWeight: 600 as const, color: "var(--c-text)" }}>Orchestrator</span>
        <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)" }}>{phase}</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setMode((m) => (m === "side" ? "float" : "side"))}
          aria-pressed={mode === "side"}
          title={mode === "side" ? "Undock to floating" : "Dock as side panel"}
          className="cadre-hover"
          style={{ ...headBtn, color: mode === "side" ? "var(--c-accent)" : "var(--c-text-muted)" }}
        >
          <PanelRight size={15} strokeWidth={2} />
        </button>
        <button
          onClick={() => setMode((m) => (m === "max" ? "float" : "max"))}
          aria-pressed={mode === "max"}
          title={mode === "max" ? "Restore" : "Maximize"}
          className="cadre-hover"
          style={headBtn}
        >
          {mode === "max" ? <Minimize2 size={15} strokeWidth={2} /> : <Maximize2 size={14} strokeWidth={2} />}
        </button>
        <button onClick={() => setOpen(false)} aria-label="Close" title="Close" className="cadre-hover" style={headBtn}>
          <X size={16} strokeWidth={2} />
        </button>
      </div>
      <div style={{ display: "flex", gap: 12, padding: "6px var(--c-space-3)", borderBottom: "1px solid var(--c-border)", fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)", flexWrap: "wrap" }}>
        <span>{stories.length} tasks</span>
        {counts.building > 0 && <span style={{ color: "var(--c-accent)" }}>{counts.building} building</span>}
        {counts.approved > 0 && <span>{counts.approved} approved</span>}
        {counts.draft > 0 && <span>{counts.draft} draft</span>}
        {counts.blocked > 0 && <span style={{ color: "var(--c-danger)" }}>{counts.blocked} blocked</span>}
        {counts.done > 0 && <span style={{ color: "var(--c-success)" }}>{counts.done} done</span>}
      </div>

      {/* Conversation */}
      <div ref={scrollRef} style={{ flex: 1, overflow: "auto", padding: "var(--c-space-3)", display: "flex", flexDirection: "column", gap: 10 }}>
        {messages.length === 0 ? (
          <div style={{ margin: "auto 0", color: "var(--c-text-muted)", fontSize: "var(--c-fs-sm)", lineHeight: 1.6 }}>
            I can see the whole project. Ask me what's next, what's blocked, or how to sequence the work — and use the actions below to add or dispatch tasks.
          </div>
        ) : (
          messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} style={{ alignSelf: "flex-end", maxWidth: "85%", background: "var(--c-surface-3)", borderRadius: "var(--c-radius)", padding: "6px 10px", fontSize: "var(--c-fs-sm)", color: "var(--c-text)" }}>
                {m.content}
              </div>
            ) : (
              <div key={i} style={{ maxWidth: "92%", fontSize: "var(--c-fs-sm)", color: "var(--c-text-secondary)" }}>
                <Markdown className="cadre-md" content={m.content || "…"} />
              </div>
            )
          )
        )}
      </div>

      {/* Quick actions + composer */}
      <div style={{ padding: "8px var(--c-space-3)", borderTop: "1px solid var(--c-border)" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 7 }}>
          {action(() => shardNextStory(1), "Add story", Plus)}
          {action(() => shardBacklog(1), "Full backlog", ScrollText)}
          {action(() => dispatchReady(), "Dispatch ready", Play)}
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, background: "var(--c-surface-2)", border: "1px solid var(--c-border-strong)", borderRadius: "var(--c-radius)", padding: "5px 5px 5px 9px" }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            rows={1}
            placeholder={planAuth.ready ? "Ask the Orchestrator…" : (planAuth.reason ?? "Add your API key first")}
            disabled={!planAuth.ready}
            style={{ flex: 1, resize: "none", maxHeight: 90, background: "transparent", border: "none", outline: "none", color: "var(--c-text)", fontSize: "var(--c-fs-sm)", fontFamily: "var(--c-font-ui)", lineHeight: 1.5, padding: "3px 0" }}
          />
          <button
            onClick={() => send(draft)}
            disabled={!draft.trim() || thinking || !planAuth.ready}
            aria-label="Send"
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: "var(--c-radius-sm)", background: draft.trim() && !thinking ? "var(--c-accent)" : "var(--c-surface-3)", color: draft.trim() && !thinking ? "var(--c-on-accent)" : "var(--c-text-muted)", border: "none", cursor: draft.trim() && !thinking ? "pointer" : "default", flexShrink: 0 }}
          >
            <ArrowUp size={15} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}
