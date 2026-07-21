import { useState, type CSSProperties } from "react";
import { marked } from "marked";
import { Lock, ArrowUp, FileText, PencilRuler, KeyRound } from "lucide-react";
import { useSettingsStore } from "../stores/settingsStore";
import { planningTurn, type ChatMessage } from "../lib/planning/planningChat";

const MODEL = "claude-sonnet-4-6";

const PM_SYSTEM_PROMPT = `You are John, a sharp, pragmatic Product Manager helping the user turn an idea into a clear, complete PRD.

Converse to draw out: goals, target users, core requirements, scope, and constraints. Ask focused questions one or two at a time. Keep replies concise and concrete. Never invent facts — ask when unsure.

Whenever the PRD should change, call the write_document tool with the FULL current PRD in Markdown, using these sections: ## Goals, ## Target Users, ## Requirements, ## Epics, ## Out of Scope. Keep it updated as the conversation progresses.`;

const paneHead: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--c-space-2)",
  padding: "var(--c-space-2) var(--c-space-4)",
  borderBottom: "1px solid var(--c-border)",
  flexShrink: 0,
};

const personaBadge: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: "var(--c-fs-sm)",
  color: "var(--c-accent)",
  background: "var(--c-accent-subtle)",
  border: "1px solid var(--c-accent-ring)",
  borderRadius: "var(--c-radius-full)",
  padding: "2px 10px",
};

export function PlanningStudio() {
  const apiKey = useSettingsStore((s) => s.anthropicApiKey);
  const setApiKey = useSettingsStore((s) => s.setAnthropicApiKey);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [doc, setDoc] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    if (!apiKey) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setDraft("");
    setBusy(true);
    try {
      const result = await planningTurn({
        apiKey,
        model: MODEL,
        systemPrompt: PM_SYSTEM_PROMPT,
        messages: next,
      });
      setMessages([
        ...next,
        { role: "assistant", content: result.reply || "(updated the document)" },
      ]);
      if (result.document) setDoc(result.document);
    } catch (e) {
      setMessages([...next, { role: "assistant", content: `Error: ${String(e)}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Conversation */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={paneHead}>
            <span style={personaBadge}>
              <PencilRuler size={13} strokeWidth={2} /> PM · John
            </span>
            <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)" }}>
              Product Manager · shaping your PRD
            </span>
          </div>

          {!apiKey && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--c-space-2)",
                margin: "var(--c-space-3)",
                padding: "8px 10px",
                background: "var(--c-warning-subtle)",
                border: "1px solid var(--c-border)",
                borderRadius: "var(--c-radius)",
              }}
            >
              <KeyRound size={14} style={{ color: "var(--c-warning)", flexShrink: 0 }} />
              <input
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                placeholder="Paste your Anthropic API key to start"
                type="password"
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: "var(--c-text)",
                  fontSize: "var(--c-fs-sm)",
                  fontFamily: "var(--c-font-mono)",
                }}
              />
              <button onClick={() => keyDraft.trim() && setApiKey(keyDraft.trim())} style={miniBtn}>
                Save
              </button>
            </div>
          )}

          <div style={{ flex: 1, overflow: "auto", padding: "var(--c-space-4)", display: "flex", flexDirection: "column" }}>
            {messages.length === 0 ? (
              <div style={{ margin: "auto 0" }}>
                <p style={{ fontSize: "var(--c-fs-md)", lineHeight: 1.6, color: "var(--c-text-secondary)", maxWidth: 380 }}>
                  Hi — I'm <b style={{ color: "var(--c-text)" }}>John</b>, your PM. Tell me what
                  you want to build and I'll turn it into a real PRD.
                </p>
                <div style={{ fontSize: "var(--c-fs-xl)", fontWeight: 600 as const, marginTop: "var(--c-space-4)" }}>
                  What do you want to build?
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--c-space-3)" }}>
                {messages.map((m, i) => (
                  <Bubble key={i} role={m.role} content={m.content} />
                ))}
                {busy && <div style={{ fontSize: "var(--c-fs-sm)", color: "var(--c-text-muted)" }}>John is thinking…</div>}
              </div>
            )}
          </div>

          <div style={{ padding: "0 var(--c-space-4) var(--c-space-4)" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--c-space-2)",
                background: "var(--c-surface-1)",
                border: "1px solid var(--c-border-strong)",
                borderRadius: "var(--c-radius-lg)",
                padding: "10px 10px 10px 14px",
              }}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder={apiKey ? "Describe your idea…" : "Add your API key above to start"}
                disabled={!apiKey || busy}
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: "var(--c-text)",
                  fontSize: "var(--c-fs-md)",
                  fontFamily: "var(--c-font-ui)",
                }}
              />
              <button
                onClick={send}
                disabled={!draft.trim() || busy || !apiKey}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 30,
                  height: 30,
                  borderRadius: "var(--c-radius)",
                  background: draft.trim() && apiKey ? "var(--c-accent)" : "var(--c-surface-3)",
                  color: draft.trim() && apiKey ? "var(--c-on-accent)" : "var(--c-text-muted)",
                  border: "none",
                  cursor: draft.trim() && apiKey ? "pointer" : "default",
                }}
              >
                <ArrowUp size={16} strokeWidth={2.5} />
              </button>
            </div>
          </div>
        </div>

        {/* Live document */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", borderLeft: "1px solid var(--c-border)", background: "var(--c-bg)", minWidth: 0 }}>
          <div style={paneHead}>
            <FileText size={13} strokeWidth={2} style={{ color: "var(--c-text-muted)" }} />
            <span style={{ fontSize: "var(--c-fs-sm)", fontFamily: "var(--c-font-mono)", color: "var(--c-text-secondary)" }}>
              docs/prd.md
            </span>
            <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>
              writes itself as you talk
            </span>
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: "var(--c-space-5)" }}>
            {doc ? (
              <div
                className="cadre-doc"
                style={{ fontSize: "var(--c-fs-md)", lineHeight: 1.6, color: "var(--c-text-secondary)" }}
                dangerouslySetInnerHTML={{ __html: marked.parse(doc) as string }}
              />
            ) : (
              <div style={{ color: "var(--c-text-faint)", fontSize: "var(--c-fs-sm)", textAlign: "center", marginTop: "var(--c-space-6)" }}>
                Your PRD appears here, section by section, as you and John talk it through.
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--c-space-2)",
          padding: "9px",
          background: "var(--c-danger-subtle)",
          borderTop: "1px solid var(--c-border)",
          color: "var(--c-danger)",
          fontSize: "var(--c-fs-sm)",
          flexShrink: 0,
        }}
      >
        <Lock size={12} strokeWidth={2} />
        Fleet locked — approve a PRD + architecture (and confirm the test command) to dispatch.
      </div>
    </div>
  );
}

const miniBtn: CSSProperties = {
  fontSize: "var(--c-fs-xs)",
  fontWeight: 550 as const,
  padding: "4px 10px",
  borderRadius: "var(--c-radius-sm)",
  background: "var(--c-accent)",
  color: "var(--c-on-accent)",
  border: "none",
  cursor: "pointer",
};

function Bubble({ role, content }: { role: "user" | "assistant"; content: string }) {
  const isUser = role === "user";
  return (
    <div
      style={{
        alignSelf: isUser ? "flex-end" : "flex-start",
        maxWidth: "82%",
        background: isUser ? "var(--c-accent-subtle)" : "var(--c-surface-2)",
        border: `1px solid ${isUser ? "var(--c-accent-ring)" : "var(--c-border)"}`,
        borderRadius: "var(--c-radius-lg)",
        padding: "8px 12px",
        fontSize: "var(--c-fs-md)",
        lineHeight: 1.5,
        color: "var(--c-text)",
        whiteSpace: "pre-wrap",
      }}
    >
      {content}
    </div>
  );
}
