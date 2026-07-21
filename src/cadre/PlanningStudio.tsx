import { useState, useRef, useEffect, type CSSProperties, type ClipboardEvent, type KeyboardEvent } from "react";
import { marked } from "marked";
import { ArrowUp, ArrowRight, Lock, RefreshCw, AlertTriangle, FileText, PencilRuler, Ruler, Palette, ClipboardCheck, KeyRound, ShieldCheck, Paperclip, X, Check, Copy, Eye, Code2 } from "lucide-react";
import { useSettingsStore } from "../stores/settingsStore";
import { useCadre, MODEL } from "./useCadre";
import { planningTurn, type ChatMessage, type Attachment } from "../lib/planning/planningChat";
import { PM_SYSTEM_PROMPT, ARCHITECT_SYSTEM_PROMPT, DESIGN_SYSTEM_PROMPT, PO_SYSTEM_PROMPT } from "../lib/planning/personas";

/** Read a pasted/dropped File as text. */
function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

/** Name an attachment from a markdown heading or its first line. */
function guessName(text: string): string {
  const heading = text.match(/^#{1,6}\s+(.+)$/m)?.[1];
  const first = heading ?? text.split("\n").find((l) => l.trim().length > 0) ?? "pasted";
  const slug = first.trim().slice(0, 40).replace(/[^\w.\- ]+/g, "").trim();
  return slug ? `${slug}.md` : "pasted.md";
}

// Treat a paste as a document (not inline text) when it's large or multi-paragraph.
const DOC_PASTE_MIN_CHARS = 800;
const DOC_PASTE_MIN_LINES = 4;

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

type PersonaId = "pm" | "architect" | "design" | "po";

const PERSONAS: Record<
  PersonaId,
  { label: string; icon: typeof PencilRuler; sub: string; file: string; intro: string; opener: string }
> = {
  pm: {
    label: "PM",
    icon: PencilRuler,
    sub: "Product Manager · shaping your PRD",
    file: "docs/prd.md",
    intro: "I'm your PM. Tell me what you want to build and I'll turn it into a real PRD.",
    opener: "What do you want to build?",
  },
  architect: {
    label: "Architect",
    icon: Ruler,
    sub: "System Architect · shaping the build",
    file: "docs/architecture.md",
    intro: "I'm your Architect. Once there's a PRD, I'll turn it into a build-ready architecture.",
    opener: "How should we build it?",
  },
  design: {
    label: "Design",
    icon: Palette,
    sub: "UX Designer · shaping the interface",
    file: "docs/ux-spec.md",
    intro: "I'm your Designer. From the PRD I'll shape the UX and mock up the actual screens.",
    opener: "What should it look and feel like?",
  },
  po: {
    label: "PO",
    icon: ClipboardCheck,
    sub: "Product Owner · validating the plan",
    file: "docs/po-validation.md",
    intro: "I'm your PO. I check the plan against your goals and flag gaps before the fleet builds it.",
    opener: "Ready for a plan review?",
  },
};

const PERSONA_IDS: PersonaId[] = ["pm", "architect", "design", "po"];

const paneHead: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--c-space-2)",
  padding: "var(--c-space-2) var(--c-space-4)",
  borderBottom: "1px solid var(--c-border)",
  flexShrink: 0,
};

export function PlanningStudio() {
  const apiKey = useSettingsStore((s) => s.anthropicApiKey);
  const setApiKey = useSettingsStore((s) => s.setAnthropicApiKey);

  const prd = useCadre((s) => s.prd);
  const architecture = useCadre((s) => s.architecture);
  const uxSpec = useCadre((s) => s.uxSpec);
  const mockupHtml = useCadre((s) => s.mockupHtml);
  const poValidation = useCadre((s) => s.poValidation);
  const setPrd = useCadre((s) => s.setPrd);
  const setArchitecture = useCadre((s) => s.setArchitecture);
  const setUxSpec = useCadre((s) => s.setUxSpec);
  const setMockupHtml = useCadre((s) => s.setMockupHtml);
  const setPoValidation = useCadre((s) => s.setPoValidation);
  const approvePlan = useCadre((s) => s.approvePlan);
  const cascadeReplan = useCadre((s) => s.cascadeReplan);
  const needsReplan = useCadre((s) => s.needsReplan);
  const verification = useCadre((s) => s.verification);
  const busy = useCadre((s) => s.busy);
  const error = useCadre((s) => s.error);

  const [persona, setPersona] = useState<PersonaId>("pm");
  const [threads, setThreads] = useState<Record<PersonaId, ChatMessage[]>>({ pm: [], architect: [], design: [], po: [] });
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [thinking, setThinking] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [verifyCmd, setVerifyCmd] = useState("npm test");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [designView, setDesignView] = useState<"spec" | "preview">("preview");
  const [verifySuggested, setVerifySuggested] = useState(false);
  // Which roles the PM has brought in this session (the user reaches them only via the PM).
  const [handedOff, setHandedOff] = useState<Record<PersonaId, boolean>>({ pm: true, architect: false, design: false, po: false });

  const docFor = (id: PersonaId) =>
    id === "pm" ? prd : id === "architect" ? architecture : id === "design" ? uxSpec : poValidation;
  const doc = docFor(persona);
  const setDoc =
    persona === "pm"
      ? setPrd
      : persona === "architect"
        ? setArchitecture
        : persona === "design"
          ? setUxSpec
          : setPoValidation;
  const messages = threads[persona];
  const meta = PERSONAS[persona];
  const canApprove = prd.trim().length > 0 && architecture.trim().length > 0;
  const canSend = (draft.trim().length > 0 || attachments.length > 0) && !!apiKey && !thinking;

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Keep the conversation pinned to the latest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, thinking, persona, suggestions]);

  // Auto-grow the composer as the user types (capped).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  // Suggestions belong to the active persona's last turn.
  useEffect(() => {
    setSuggestions([]);
  }, [persona]);

  function onInputKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function addAttachments(items: Attachment[]) {
    if (items.length) setAttachments((a) => [...a, ...items]);
  }

  // Paste a doc → attach it to the turn. Files always attach; large/multi-line
  // text attaches as a document; short text pastes into the input as normal.
  async function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const dt = e.clipboardData;
    if (dt.files && dt.files.length > 0) {
      e.preventDefault();
      const files = Array.from(dt.files);
      const atts = await Promise.all(
        files.map(async (f) => ({ name: f.name || "pasted.md", content: await readFileText(f) }))
      );
      addAttachments(atts);
      return;
    }
    const text = dt.getData("text");
    const lines = text ? (text.match(/\n/g)?.length ?? 0) + 1 : 0;
    if (text && (text.length >= DOC_PASTE_MIN_CHARS || lines >= DOC_PASTE_MIN_LINES)) {
      e.preventDefault();
      addAttachments([{ name: guessName(text), content: text }]);
    }
  }

  // Explicit "attach whatever's on the clipboard" affordance.
  async function attachFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) addAttachments([{ name: guessName(text), content: text }]);
    } catch {
      /* clipboard unavailable / permission denied */
    }
  }

  function systemPromptFor(id: PersonaId): string {
    if (id === "pm") {
      // On re-entry with an existing PRD, the PM amends scope in place — new
      // requirements always flow through the PM (§5.1), not a loose story.
      return prd.trim()
        ? `${PM_SYSTEM_PROMPT}\n\n## Current PRD (amend this as new requirements or added scope arrive; always emit the FULL updated PRD via write_document)\n${prd}`
        : PM_SYSTEM_PROMPT;
    }
    if (id === "po") {
      // The PO validates against everything produced so far.
      let ctx = PO_SYSTEM_PROMPT;
      if (prd.trim()) ctx += `\n\n## PRD (context)\n${prd}`;
      if (architecture.trim()) ctx += `\n\n## Architecture (context)\n${architecture}`;
      if (uxSpec.trim()) ctx += `\n\n## UX Spec (context)\n${uxSpec}`;
      return ctx;
    }
    const base = id === "architect" ? ARCHITECT_SYSTEM_PROMPT : DESIGN_SYSTEM_PROMPT;
    return prd.trim() ? `${base}\n\n## PRD (context)\n${prd}` : base;
  }

  // `override` lets a quick-reply chip send its text directly.
  async function send(override?: string) {
    const text = (override ?? draft).trim();
    if ((!text && attachments.length === 0) || thinking || !apiKey) return;
    const active = persona;
    const base: ChatMessage[] = [
      ...messages,
      { role: "user", content: text, attachments: attachments.length ? attachments : undefined },
    ];
    // Append an empty assistant placeholder that we stream into (Claude-style).
    setThreads((t) => ({ ...t, [active]: [...base, { role: "assistant", content: "" }] }));
    setDraft("");
    setAttachments([]);
    setSuggestions([]);
    setThinking(true);

    // Replace the trailing assistant placeholder as tokens arrive.
    const setAssistant = (content: string) =>
      setThreads((t) => {
        const arr = t[active].slice();
        arr[arr.length - 1] = { role: "assistant", content };
        return { ...t, [active]: arr };
      });

    let acc = "";
    try {
      const result = await planningTurn({
        apiKey,
        model: MODEL,
        systemPrompt: systemPromptFor(active),
        messages: base,
        allowMockup: active === "design",
        allowVerification: active === "architect",
        allowHandoff: active === "pm",
        onText: (delta) => {
          acc += delta;
          setAssistant(acc);
        },
      });
      // The PM authorizes the next role by handing off — it unlocks (user proceeds when ready).
      if (active === "pm" && result.handoff) {
        setHandedOff((h) => ({ ...h, [result.handoff as PersonaId]: true }));
      }
      setAssistant((result.reply || acc).trim() || "(updated the document)");
      if (result.document) setDoc(result.document);
      if (result.mockup) {
        setMockupHtml(result.mockup);
        setDesignView("preview");
      }
      // The Architect proposes the verify command; pre-fill it for one-click confirm.
      if (result.verification) {
        setVerifyCmd(result.verification);
        setVerifySuggested(true);
      }
      if (result.suggestions && result.suggestions.length) setSuggestions(result.suggestions);
    } catch (e) {
      setAssistant(`Error: ${String(e)}`);
    } finally {
      setThinking(false);
      // Return focus to the composer so the user can keep typing immediately.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  const showDesignPreview = persona === "design" && designView === "preview";
  const prdReady = prd.trim().length > 0;
  // A role is reachable only if the PM has handed off to it (or its doc already exists, e.g. on reload).
  const isOpen = (id: PersonaId) => id === "pm" || handedOff[id] || docFor(id).trim().length > 0;
  const architectOpen = isOpen("architect");

  // Next-step guidance — PM-mediated (the PM brings in the Architect).
  const guidance: { done: string | null; msg: string; to: PersonaId | null; cta: string } = !prdReady
    ? persona === "pm"
      ? { done: null, msg: "Start here — describe your idea and the PM will close down the requirements.", to: null, cta: "" }
      : { done: null, msg: "Everything starts with the PM.", to: "pm", cta: "Go to PM" }
    : persona === "architect"
      ? { done: "PRD ready", msg: "Now talk to the Architect to design the build.", to: null, cta: "" }
      : architectOpen
        ? { done: "PRD ready", msg: "The PM brought in the Architect.", to: "architect", cta: "Go to Architect" }
        : { done: "PRD ready", msg: "Ask the PM to bring in the Architect when the requirements are set.", to: null, cta: "" };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Conversation */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={paneHead}>
            {PERSONA_IDS.map((id) => {
              const P = PERSONAS[id];
              const active = id === persona;
              const ready = docFor(id).trim().length > 0;
              // PM is always open; the rest unlock only when the PM hands off to them.
              const locked = !isOpen(id);
              return (
                <button
                  key={id}
                  onClick={() => !locked && setPersona(id)}
                  disabled={locked}
                  title={locked ? "The PM closes the requirements first — draft the PRD to unlock." : undefined}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: "var(--c-fs-sm)",
                    fontWeight: 550 as const,
                    color: locked ? "var(--c-text-faint)" : active ? "var(--c-accent)" : "var(--c-text-muted)",
                    background: active ? "var(--c-accent-subtle)" : "transparent",
                    border: `1px solid ${active ? "var(--c-accent-ring)" : "transparent"}`,
                    borderRadius: "var(--c-radius-full)",
                    padding: "2px 10px",
                    cursor: locked ? "not-allowed" : "pointer",
                    opacity: locked ? 0.55 : 1,
                    transition: "background var(--c-dur) var(--c-ease-out)",
                  }}
                >
                  <P.icon size={13} strokeWidth={2} /> {P.label}
                  {ready ? (
                    <Check size={12} strokeWidth={3} style={{ color: "var(--c-success)" }} />
                  ) : locked ? (
                    <Lock size={11} strokeWidth={2} />
                  ) : null}
                </button>
              );
            })}
            <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)" }}>{meta.sub}</span>
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

          <div ref={scrollRef} style={{ flex: 1, overflow: "auto", padding: "var(--c-space-4)", display: "flex", flexDirection: "column" }}>
            {messages.length === 0 ? (
              <div style={{ margin: "auto 0" }}>
                <p style={{ fontSize: "var(--c-fs-md)", lineHeight: 1.6, color: "var(--c-text-secondary)", maxWidth: 380 }}>
                  {meta.intro}
                </p>
                <div style={{ fontSize: "var(--c-fs-xl)", fontWeight: 600 as const, marginTop: "var(--c-space-4)" }}>
                  {meta.opener}
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--c-space-4)", maxWidth: 720, width: "100%", margin: "0 auto" }}>
                {messages.map((m, i) => {
                  if (m.role === "assistant" && !m.content) return null;
                  const streaming = thinking && i === messages.length - 1 && m.role === "assistant";
                  return (
                    <Message
                      key={i}
                      role={m.role}
                      content={m.content}
                      attachments={m.attachments}
                      Icon={meta.icon}
                      streaming={streaming}
                    />
                  );
                })}
                {thinking &&
                  messages[messages.length - 1]?.role === "assistant" &&
                  !messages[messages.length - 1]?.content && <Loading Icon={meta.icon} label={meta.label} />}
              </div>
            )}
          </div>

          <div style={{ padding: "0 var(--c-space-4) var(--c-space-4)" }}>
            {suggestions.length > 0 && !thinking && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: "var(--c-space-2)" }}>
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    className="cadre-chip"
                    onClick={() => send(s)}
                    style={{
                      fontSize: "var(--c-fs-sm)",
                      color: "var(--c-accent)",
                      background: "var(--c-accent-subtle)",
                      border: "1px solid var(--c-accent-ring)",
                      borderRadius: "var(--c-radius-full)",
                      padding: "4px 12px",
                      cursor: "pointer",
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {attachments.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: "var(--c-space-2)" }}>
                {attachments.map((a, i) => (
                  <AttachChip
                    key={i}
                    name={a.name}
                    chars={a.content.length}
                    onRemove={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                  />
                ))}
              </div>
            )}
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: "var(--c-space-2)",
                background: "var(--c-surface-1)",
                border: "1px solid var(--c-border-strong)",
                borderRadius: "var(--c-radius-lg)",
                padding: "8px 8px 8px 10px",
              }}
            >
              <button
                onClick={attachFromClipboard}
                disabled={!apiKey || thinking}
                title="Attach a document from the clipboard"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 30,
                  height: 30,
                  borderRadius: "var(--c-radius-sm)",
                  background: "transparent",
                  border: "none",
                  color: "var(--c-text-muted)",
                  cursor: apiKey && !thinking ? "pointer" : "default",
                  flexShrink: 0,
                }}
              >
                <Paperclip size={16} strokeWidth={2} />
              </button>
              <textarea
                ref={inputRef}
                value={draft}
                rows={1}
                onChange={(e) => setDraft(e.target.value)}
                onPaste={onPaste}
                onKeyDown={onInputKeyDown}
                placeholder={apiKey ? `Talk to the ${meta.label}…  (Enter to send · Shift+Enter for a new line · paste a doc to attach)` : "Add your API key above to start"}
                disabled={!apiKey}
                style={{
                  flex: 1,
                  resize: "none",
                  maxHeight: 160,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: "var(--c-text)",
                  fontSize: "var(--c-fs-md)",
                  fontFamily: "var(--c-font-ui)",
                  lineHeight: 1.5,
                  padding: "5px 0",
                }}
              />
              <button
                onClick={() => send()}
                disabled={!canSend}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 30,
                  height: 30,
                  borderRadius: "var(--c-radius)",
                  background: canSend ? "var(--c-accent)" : "var(--c-surface-3)",
                  color: canSend ? "var(--c-on-accent)" : "var(--c-text-muted)",
                  border: "none",
                  cursor: canSend ? "pointer" : "default",
                  flexShrink: 0,
                }}
              >
                <ArrowUp size={16} strokeWidth={2.5} />
              </button>
            </div>
          </div>
        </div>

        {/* Live document / mockup */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", borderLeft: "1px solid var(--c-border)", background: "var(--c-bg)", minWidth: 0 }}>
          <div style={paneHead}>
            <FileText size={13} strokeWidth={2} style={{ color: "var(--c-text-muted)" }} />
            <span style={{ fontSize: "var(--c-fs-sm)", fontFamily: "var(--c-font-mono)", color: "var(--c-text-secondary)" }}>
              {showDesignPreview ? "docs/mockup.html" : meta.file}
            </span>
            {thinking ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--c-fs-xs)", color: "var(--c-accent)" }}>
                <Dots /> {showDesignPreview ? "rendering" : "drafting"}
              </span>
            ) : (
              <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>
                {showDesignPreview
                  ? mockupHtml
                    ? "live preview"
                    : "mockup appears here"
                  : doc
                    ? `${wordCount(doc)} words`
                    : "writes itself as you talk"}
              </span>
            )}
            <div style={{ flex: 1 }} />
            {persona === "design" && (
              <div style={{ display: "flex", gap: 2, marginRight: "var(--c-space-2)" }}>
                {(["preview", "spec"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setDesignView(v)}
                    title={v === "preview" ? "Rendered mockup" : "UX spec"}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: "var(--c-fs-xs)",
                      fontWeight: 550 as const,
                      textTransform: "capitalize",
                      padding: "2px 9px",
                      borderRadius: "var(--c-radius-full)",
                      border: "1px solid transparent",
                      background: designView === v ? "var(--c-surface-3)" : "transparent",
                      color: designView === v ? "var(--c-text)" : "var(--c-text-muted)",
                      cursor: "pointer",
                    }}
                  >
                    {v === "preview" ? <Eye size={11} strokeWidth={2} /> : <Code2 size={11} strokeWidth={2} />}
                    {v}
                  </button>
                ))}
              </div>
            )}
            {showDesignPreview ? mockupHtml && <CopyButton text={mockupHtml} label="HTML" /> : doc && <CopyButton text={doc} />}
          </div>

          {showDesignPreview ? (
            mockupHtml ? (
              <div style={{ flex: 1, padding: "var(--c-space-3)", minHeight: 0 }}>
                <iframe
                  title="UI mockup"
                  srcDoc={mockupHtml}
                  sandbox=""
                  style={{ width: "100%", height: "100%", border: "1px solid var(--c-border)", borderRadius: "var(--c-radius)", background: "#fff" }}
                />
              </div>
            ) : thinking ? (
              <DocDrafting label={meta.label} file="docs/mockup.html" verb="mocking up" />
            ) : (
              <EmptyPane text="The Designer mocks up the actual screens here — describe the UI to begin." />
            )
          ) : doc ? (
            <div style={{ flex: 1, overflow: "auto", padding: "var(--c-space-5)" }}>
              <div
                className="cadre-doc"
                style={{ color: "var(--c-text-secondary)" }}
                dangerouslySetInnerHTML={{ __html: marked.parse(doc) as string }}
              />
            </div>
          ) : thinking ? (
            <DocDrafting label={meta.label} file={meta.file} verb="drafting" />
          ) : (
            <EmptyPane
              text={
                persona === "pm"
                  ? "Your PRD appears here, section by section, as you and the PM talk it through."
                  : persona === "architect"
                    ? "The architecture appears here as you and the Architect design the build."
                    : persona === "design"
                      ? "The UX spec appears here as you and the Designer shape the experience."
                      : "The validation report appears here as the PO reviews the plan."
              }
            />
          )}
        </div>
      </div>

      {/* Approve gate */}
      {error && (
        <div
          style={{
            padding: "6px var(--c-space-4)",
            background: "var(--c-danger-subtle)",
            borderTop: "1px solid var(--c-border)",
            color: "var(--c-danger)",
            fontSize: "var(--c-fs-sm)",
          }}
        >
          {error}
        </div>
      )}
      {needsReplan ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--c-space-3)",
            padding: "9px var(--c-space-4)",
            background: "var(--c-warning-subtle)",
            borderTop: "1px solid var(--c-border)",
            flexShrink: 0,
          }}
        >
          <AlertTriangle size={15} strokeWidth={2} style={{ color: "var(--c-warning)", flexShrink: 0 }} />
          <span style={{ fontSize: "var(--c-fs-sm)", color: "var(--c-text-secondary)" }}>
            Scope changed since approval — apply it downstream, then re-approve.
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
              padding: "5px 12px",
              borderRadius: "var(--c-radius)",
              background: busy ? "var(--c-surface-3)" : "var(--c-surface-2)",
              color: busy ? "var(--c-text-muted)" : "var(--c-text)",
              border: "1px solid var(--c-border-strong)",
              cursor: busy ? "default" : "pointer",
              flexShrink: 0,
            }}
          >
            <RefreshCw size={13} strokeWidth={2} />
            {busy ?? "Apply changes"}
          </button>
          <button
            onClick={() => approvePlan(verification.length ? verification : [verifyCmd])}
            disabled={!!busy}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: "var(--c-fs-sm)",
              fontWeight: 550 as const,
              padding: "5px 12px",
              borderRadius: "var(--c-radius)",
              background: busy ? "var(--c-surface-3)" : "var(--c-success)",
              color: busy ? "var(--c-text-muted)" : "var(--c-on-accent)",
              border: "none",
              cursor: busy ? "default" : "pointer",
              flexShrink: 0,
            }}
          >
            <ShieldCheck size={13} strokeWidth={2} />
            Re-approve
          </button>
        </div>
      ) : canApprove ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--c-space-3)",
            padding: "9px var(--c-space-4)",
            background: "var(--c-success-subtle)",
            borderTop: "1px solid var(--c-border)",
            flexShrink: 0,
          }}
        >
          <ShieldCheck size={15} strokeWidth={2} style={{ color: "var(--c-success)", flexShrink: 0 }} />
          <span style={{ fontSize: "var(--c-fs-sm)", color: "var(--c-text-secondary)", flexShrink: 0 }}>
            Plan ready. Cadre verifies every story against:
          </span>
          <input
            value={verifyCmd}
            onChange={(e) => {
              setVerifyCmd(e.target.value);
              setVerifySuggested(false);
            }}
            placeholder="npm test"
            style={{
              flex: 1,
              minWidth: 120,
              background: "var(--c-surface-1)",
              border: "1px solid var(--c-border-strong)",
              borderRadius: "var(--c-radius)",
              outline: "none",
              color: "var(--c-text)",
              fontSize: "var(--c-fs-sm)",
              fontFamily: "var(--c-font-mono)",
              padding: "5px 10px",
            }}
          />
          {verifySuggested && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: "var(--c-fs-xs)",
                color: "var(--c-accent)",
                flexShrink: 0,
              }}
            >
              <Ruler size={11} strokeWidth={2} /> Architect's suggestion
            </span>
          )}
          <button
            onClick={() => approvePlan([verifyCmd])}
            disabled={!!busy || !verifyCmd.trim()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: "var(--c-fs-sm)",
              fontWeight: 550 as const,
              padding: "6px 14px",
              borderRadius: "var(--c-radius)",
              background: busy ? "var(--c-surface-3)" : "var(--c-success)",
              color: busy ? "var(--c-text-muted)" : "var(--c-on-accent)",
              border: "none",
              cursor: busy ? "default" : "pointer",
              flexShrink: 0,
            }}
          >
            {busy ?? "Approve plan → dispatch"}
          </button>
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--c-space-2)",
            padding: "9px var(--c-space-4)",
            background: "var(--c-surface-1)",
            borderTop: "1px solid var(--c-border)",
            fontSize: "var(--c-fs-sm)",
            flexShrink: 0,
          }}
        >
          <ArrowRight size={14} strokeWidth={2.5} style={{ color: "var(--c-accent)", flexShrink: 0 }} />
          {guidance.done && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: "var(--c-fs-xs)",
                fontWeight: 550 as const,
                color: "var(--c-success)",
                background: "var(--c-success-subtle)",
                border: "1px solid var(--c-border)",
                borderRadius: "var(--c-radius-full)",
                padding: "2px 9px",
                flexShrink: 0,
              }}
            >
              <Check size={11} strokeWidth={3} /> {guidance.done}
            </span>
          )}
          <span style={{ color: "var(--c-text-secondary)" }}>{guidance.msg}</span>
          <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>· Design &amp; PO optional</span>
          <div style={{ flex: 1 }} />
          {guidance.to && (
            <button
              onClick={() => setPersona(guidance.to as PersonaId)}
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
                flexShrink: 0,
              }}
            >
              {guidance.cta}
              <ArrowRight size={13} strokeWidth={2.5} />
            </button>
          )}
        </div>
      )}
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

/** Three animated typing dots that inherit color. */
function Dots() {
  return (
    <span style={{ display: "inline-flex", gap: 3 }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="cadre-typing-dot"
          style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor", display: "inline-block" }}
        />
      ))}
    </span>
  );
}

/** Doc-pane placeholder shown while a persona is writing the document. */
function DocDrafting({ label, file, verb }: { label: string; file: string; verb: string }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--c-space-5)" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <span style={{ color: "var(--c-accent)" }}>
          <Dots />
        </span>
        <span style={{ fontSize: "var(--c-fs-sm)", color: "var(--c-text-muted)", textAlign: "center" }}>
          The {label} is {verb}{" "}
          <span style={{ fontFamily: "var(--c-font-mono)", color: "var(--c-text-secondary)" }}>{file}</span>…
        </span>
      </div>
    </div>
  );
}

function EmptyPane({ text }: { text: string }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--c-space-5)" }}>
      <div style={{ color: "var(--c-text-faint)", fontSize: "var(--c-fs-sm)", textAlign: "center", maxWidth: 320 }}>{text}</div>
    </div>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <button
      onClick={copy}
      title="Copy"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: "var(--c-fs-xs)",
        color: copied ? "var(--c-success)" : "var(--c-text-muted)",
        background: "transparent",
        border: "1px solid var(--c-border)",
        borderRadius: "var(--c-radius-sm)",
        padding: "3px 8px",
        cursor: "pointer",
      }}
    >
      {copied ? <Check size={12} strokeWidth={2.5} /> : <Copy size={12} strokeWidth={2} />}
      {copied ? "Copied" : label}
    </button>
  );
}

function AttachChip({ name, chars, onRemove }: { name: string; chars: number; onRemove?: () => void }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        maxWidth: 220,
        fontSize: "var(--c-fs-xs)",
        color: "var(--c-text-secondary)",
        background: "var(--c-surface-2)",
        border: "1px solid var(--c-border)",
        borderRadius: "var(--c-radius-sm)",
        padding: "3px 8px",
      }}
    >
      <FileText size={12} strokeWidth={2} style={{ color: "var(--c-text-muted)", flexShrink: 0 }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
      <span style={{ color: "var(--c-text-faint)", flexShrink: 0 }}>{(chars / 1000).toFixed(1)}k</span>
      {onRemove && (
        <button
          onClick={onRemove}
          title="Remove"
          style={{ display: "inline-flex", background: "transparent", border: "none", color: "var(--c-text-muted)", cursor: "pointer", padding: 0, flexShrink: 0 }}
        >
          <X size={12} strokeWidth={2.5} />
        </button>
      )}
    </span>
  );
}

/** The persona avatar next to assistant messages (Claude-style). */
function Avatar({ Icon }: { Icon: typeof PencilRuler }) {
  return (
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: "50%",
        background: "var(--c-accent-subtle)",
        border: "1px solid var(--c-accent-ring)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--c-accent)",
        flexShrink: 0,
        marginTop: 1,
      }}
    >
      <Icon size={14} strokeWidth={2} />
    </div>
  );
}

/** Loading state before the first token (Claude-style: avatar + animated dots). */
function Loading({ Icon, label }: { Icon: typeof PencilRuler; label: string }) {
  return (
    <div className="cadre-bubble" style={{ display: "flex", gap: 10, alignItems: "center" }}>
      <Avatar Icon={Icon} />
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="cadre-typing-dot"
            style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--c-text-muted)", display: "inline-block" }}
          />
        ))}
        <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)", marginLeft: 4 }}>
          the {label} is thinking
        </span>
      </span>
    </div>
  );
}

/** A chat message. User: right-aligned soft bubble. Assistant: full-width with avatar (Claude-style). */
function Message({
  role,
  content,
  attachments,
  Icon,
  streaming,
}: {
  role: "user" | "assistant";
  content: string;
  attachments?: Attachment[];
  Icon: typeof PencilRuler;
  streaming?: boolean;
}) {
  if (role === "user") {
    return (
      <div
        className="cadre-bubble"
        style={{
          alignSelf: "flex-end",
          maxWidth: "82%",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          background: "var(--c-surface-2)",
          border: "1px solid var(--c-border)",
          borderRadius: "var(--c-radius-lg)",
          padding: "10px 14px",
          fontSize: "var(--c-fs-chat)",
          lineHeight: 1.6,
          color: "var(--c-text)",
        }}
      >
        {attachments && attachments.length > 0 && (
          <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {attachments.map((a, i) => (
              <AttachChip key={i} name={a.name} chars={a.content.length} />
            ))}
          </span>
        )}
        {content && <span style={{ whiteSpace: "pre-wrap" }}>{content}</span>}
      </div>
    );
  }
  return (
    <div className="cadre-bubble" style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
      <Avatar Icon={Icon} />
      <div style={{ flex: 1, minWidth: 0, paddingTop: 3, fontSize: "var(--c-fs-chat)", lineHeight: 1.7, color: "var(--c-text)" }}>
        <div className="cadre-md" style={{ display: "inline" }} dangerouslySetInnerHTML={{ __html: marked.parse(content) as string }} />
        {streaming && <span className="cadre-caret" />}
      </div>
    </div>
  );
}
