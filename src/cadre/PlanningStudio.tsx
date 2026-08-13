import { useState, useRef, useEffect, type CSSProperties, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from "react";
import { marked } from "marked";
import { ArrowUp, ArrowRight, Lock, RefreshCw, AlertTriangle, FileText, FileDown, PencilRuler, Ruler, Palette, ClipboardCheck, KeyRound, ShieldCheck, ShieldAlert, Gavel, Paperclip, X, Check, Copy, Eye, Code2, Wrench, Loader2, Workflow, Download } from "lucide-react";
import { exportHtmlToPdf } from "./exportPdf";
import { DiagramEditor } from "./DiagramEditor";
import { BrownfieldOnboard } from "./BrownfieldOnboard";
import { useSettingsStore } from "../stores/settingsStore";
import { useCadre, MODEL } from "./useCadre";
import { useRepos } from "../stores/reposStore";
import { useBmadStore } from "../stores/bmadStore";
import { useConnectionsStore } from "../stores/connectionsStore";
import { useMcpIntakeStore } from "../stores/mcpIntakeStore";
import { trackerConnection } from "../lib/mcp/connections";
import { ticketToBrief } from "../lib/integrations/mcpIntake";
import { Markdown } from "./components/Markdown";
import { planningTurn, type ChatMessage, type Attachment } from "../lib/planning/planningChat";
import { PM_SYSTEM_PROMPT, ARCHITECT_SYSTEM_PROMPT, DESIGN_SYSTEM_PROMPT, ADVERSARIAL_REVIEW_PROMPTS, PLAN_VALIDATION_PROMPT } from "../lib/planning/personas";
import { reviewArtifact, type ReviewResult, type Severity, type Finding } from "../lib/planning/review";
import { reportError } from "../lib/reportError";
import { resolvePlanningAuth } from "../lib/planning/planningAuth";
import { secretGet } from "../lib/secrets";

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

type PersonaId = "pm" | "architect" | "design";

const PERSONAS: Record<
  PersonaId,
  { label: string; icon: typeof PencilRuler; sub: string; file: string; intro: string; opener: string }
> = {
  pm: {
    label: "PM",
    icon: PencilRuler,
    sub: "Product Manager · discovery & the PRD",
    file: "docs/prd.md",
    intro: "I'm your PM. I'll run discovery first — the problem, market, users, and risks — then turn it all into a real PRD.",
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
};

const PERSONA_IDS: PersonaId[] = ["pm", "architect", "design"];

const paneHead: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 5,
  padding: "var(--c-space-2) var(--c-space-4)",
  borderBottom: "1px solid var(--c-border)",
  flexShrink: 0,
};

export function PlanningStudio() {
  const anthropicKey = useSettingsStore((s) => s.anthropicApiKey);
  const authProvider = useSettingsStore((s) => s.authProvider);
  const dispatchUseLogin = useSettingsStore((s) => s.dispatchUseLogin);
  const setApiKey = useSettingsStore((s) => s.setAnthropicApiKey);
  const planningModel = useSettingsStore((s) => s.planningModel) || MODEL;

  // Resolved planning auth — drives the send gate and shows the not-ready reason.
  const [planAuth, setPlanAuth] = useState<{ ready: boolean; apiKey: string; baseUrl?: string; reason?: string }>({ ready: false, apiKey: "" });
  useEffect(() => {
    resolvePlanningAuth(authProvider, dispatchUseLogin, secretGet).then((a) =>
      setPlanAuth({ ready: a.ready, apiKey: a.apiKey, baseUrl: a.baseUrl, reason: a.reason })
    );
  }, [authProvider, dispatchUseLogin, anthropicKey]);

  const prd = useCadre((s) => s.prd);
  const architecture = useCadre((s) => s.architecture);
  const uxSpec = useCadre((s) => s.uxSpec);
  const mockupHtml = useCadre((s) => s.mockupHtml);
  const projectContext = useCadre((s) => s.projectContext);
  const analyzingBrownfield = useCadre((s) => s.analyzingBrownfield);
  const documentProject = useCadre((s) => s.documentProject);
  const isBrownfield = useCadre((s) => s.isBrownfield);
  const brownfieldLog = useCadre((s) => s.logs["brownfield"] ?? "");
  const setPrd = useCadre((s) => s.setPrd);
  const setArchitecture = useCadre((s) => s.setArchitecture);
  const setUxSpec = useCadre((s) => s.setUxSpec);
  const setMockupHtml = useCadre((s) => s.setMockupHtml);
  const approvePlan = useCadre((s) => s.approvePlan);
  const cascadeReplan = useCadre((s) => s.cascadeReplan);
  const needsReplan = useCadre((s) => s.needsReplan);
  const verification = useCadre((s) => s.verification);
  const busy = useCadre((s) => s.busy);
  const error = useCadre((s) => s.error);
  const clearError = useCadre((s) => s.clearError);

  // Multi-repo: per-repo verify commands (pre-filled from registry, editable before sign-off)
  const repos = useRepos((s) => s.repos);
  const setRepoVerify = useRepos((s) => s.setVerify);
  const multiRepo = repos.length > 1;
  const projectRootForRepos = useBmadStore((s) => s.projectRoot);
  // Per-repo verify drafts (id → command), seeded from the registry
  const [repoVerifyDrafts, setRepoVerifyDrafts] = useState<Record<string, string>>({});
  // Seed drafts when repos load or change (only fill in missing entries — don't clobber user edits)
  useEffect(() => {
    if (!multiRepo) return;
    setRepoVerifyDrafts((prev) => {
      const next = { ...prev };
      for (const r of repos) {
        if (!(r.id in next)) next[r.id] = r.verify ?? "";
      }
      return next;
    });
  }, [repos, multiRepo]);

  // "Import from tracker" — reuses the same active-project root as the
  // multi-repo verify drafts above. Only rendered when a tracker connection
  // is designated (Connections view), so load the registry once we know the
  // root (mirrors ConnectionsView's own load-on-root-change effect).
  const connections = useConnectionsStore((s) => s.connections);
  const loadConnections = useConnectionsStore((s) => s.load);
  useEffect(() => {
    if (projectRootForRepos) void loadConnections(projectRootForRepos);
  }, [projectRootForRepos, loadConnections]);
  const tracker = trackerConnection(connections);
  const [ticketRef, setTicketRef] = useState("");
  const importingTicket = useMcpIntakeStore((s) => s.importing);
  async function importFromTracker() {
    const root = projectRootForRepos;
    const ref = ticketRef.trim();
    if (!root || !ref) return;
    const ticket = await useMcpIntakeStore.getState().fetchTicket(root, ref);
    if (ticket) {
      setDraft(ticketToBrief(ticket));
      setTicketRef("");
      // Best-effort: record the epic↔ticket link (epic 1, symmetric with the
      // CLI import path) so outbound sync routes this epic's story updates to
      // the imported parent ticket. recordEpicLinkFor never throws (it
      // reportErrors internally) — this must never block the pre-fill.
      void useMcpIntakeStore
        .getState()
        .recordEpicLinkFor(root, 1, { ticketId: ticket.id, url: ticket.url })
        .catch(() => {});
    }
  }

  const [persona, setPersona] = useState<PersonaId>("pm");
  const [threads, setThreads] = useState<Record<PersonaId, ChatMessage[]>>({ pm: [], architect: [], design: [] });
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [thinking, setThinking] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  // Starts EMPTY — the sign-off command comes from the Architect (suggest_verification)
  // or manifest auto-detection, never a presumptuous hardcoded default. canSign gates on
  // a non-empty command, so the CTO can't sign off an unset verify by accident.
  const [verifyCmd, setVerifyCmd] = useState("");
  const verifyTouched = useRef(false);
  const detectedVerify = useCadre((s) => s.detectedVerify);
  // Brownfield: pre-fill the sign-off command with the project's real test command —
  // but never clobber one the CTO (or the Architect) already set.
  useEffect(() => {
    if (detectedVerify && !verifyTouched.current) setVerifyCmd(detectedVerify);
  }, [detectedVerify]);
  const [split, setSplit] = useState(50); // % width of the conversation pane (draggable divider)

  function onDividerDown(e: MouseEvent) {
    e.preventDefault();
    const row = (e.currentTarget as HTMLElement).parentElement;
    if (!row) return;
    const rect = row.getBoundingClientRect();
    const onMove = (ev: globalThis.MouseEvent) => {
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setSplit(Math.min(72, Math.max(28, pct)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [designView, setDesignView] = useState<"spec" | "preview">("preview");
  const [verifySuggested, setVerifySuggested] = useState(false);
  // Which roles the PM has brought in this session (the user reaches them only via the PM).
  const [handedOff, setHandedOff] = useState<Record<PersonaId, boolean>>({ pm: true, architect: false, design: false });
  // Adversarial review state per artifact (a reviewer agent is part of the fleet).
  // Each finding must be resolved by the user (confirmed or commented) to clear the review.
  type Resolution = { action: "confirmed" | "commented"; comment?: string };
  type ReviewState = {
    status: "idle" | "reviewing" | "done";
    result?: ReviewResult;
    resolutions?: Record<number, Resolution>;
  };
  const [reviews, setReviews] = useState<Record<PersonaId, ReviewState>>({
    pm: { status: "idle" },
    architect: { status: "idle" },
    design: { status: "idle" },
  });
  const review = reviews[persona];

  function resolveFinding(index: number, action: "confirmed" | "commented", comment?: string) {
    setReviews((r) => {
      const cur = r[persona];
      return {
        ...r,
        [persona]: { ...cur, resolutions: { ...(cur.resolutions ?? {}), [index]: { action, comment } } },
      };
    });
  }

  // A review clears when it's done and every finding has been confirmed or commented.
  const reviewResolved =
    review.status === "done" &&
    !!review.result &&
    (review.result.findings.length === 0 ||
      review.result.findings.every((_, i) => review.resolutions?.[i]));

  function handoffTo(role: PersonaId) {
    setHandedOff((h) => ({ ...h, [role]: true }));
    setPersona(role);
  }

  async function runReview() {
    if (!planAuth.ready || !doc.trim() || review.status === "reviewing") return;
    const auth = await resolvePlanningAuth(authProvider, dispatchUseLogin, secretGet);
    if (!auth.ready) { reportError("planning", new Error(auth.reason ?? "planning credential missing")); return; }
    const active = persona;
    setReviews((r) => ({ ...r, [active]: { status: "reviewing" } }));
    try {
      // Reviewers hold the artifact against its upstream (the PRD), except the PM's own.
      const context = active === "pm" ? undefined : prd.trim() || undefined;
      const result = await reviewArtifact({
        apiKey: auth.apiKey,
        baseUrl: auth.baseUrl,
        model: planningModel,
        systemPrompt: ADVERSARIAL_REVIEW_PROMPTS[active],
        artifact: doc,
        context,
      });
      setReviews((r) => ({ ...r, [active]: { status: "done", result } }));
    } catch (e) {
      setReviews((r) => ({
        ...r,
        [active]: { status: "done", result: { verdict: "block", summary: String(e), findings: [] } },
      }));
      reportError("review", e);
    }
  }

  // PO sign-off: you're the human PO. This runs an adversarial PO validation over
  // the WHOLE plan (coverage vs goals, testable ACs, gaps) to assist your sign-off.
  const [poCheck, setPoCheck] = useState<{ status: "idle" | "reviewing" | "done"; result?: ReviewResult }>({ status: "idle" });
  async function runPoValidation() {
    if (!planAuth.ready || poCheck.status === "reviewing") return;
    const auth = await resolvePlanningAuth(authProvider, dispatchUseLogin, secretGet);
    if (!auth.ready) { reportError("planning", new Error(auth.reason ?? "planning credential missing")); return; }
    setPoCheck({ status: "reviewing" });
    try {
      const plan = [
        prd.trim() && `# PRD\n${prd}`,
        architecture.trim() && `# Architecture\n${architecture}`,
        uxSpec.trim() && `# UX Spec\n${uxSpec}`,
      ]
        .filter(Boolean)
        .join("\n\n---\n\n");
      const result = await reviewArtifact({
        apiKey: auth.apiKey,
        baseUrl: auth.baseUrl,
        model: planningModel,
        systemPrompt: PLAN_VALIDATION_PROMPT,
        artifact: plan,
      });
      setPoCheck({ status: "done", result });
    } catch (e) {
      setPoCheck({ status: "done", result: { verdict: "block", summary: String(e), findings: [] } });
      reportError("po validation", e);
    }
  }

  // Route selected validation gaps to a persona as a concrete fix request.
  function solveGaps(target: PersonaId, gaps: Finding[]) {
    if (!gaps.length || thinking) return;
    const list = gaps
      .map((f, i) => `${i + 1}. [${f.severity.toUpperCase()}] ${f.title} — ${f.detail}`)
      .join("\n");
    const msg =
      `The CTO's plan validation flagged these gaps for you to resolve. ` +
      `Address each one and update ${PERSONAS[target].file} accordingly, then briefly confirm what changed:\n\n${list}`;
    send(msg, target);
  }

  const docFor = (id: PersonaId) =>
    id === "pm" ? prd
    : id === "architect" ? architecture
    : uxSpec;
  const doc = docFor(persona);
  const messages = threads[persona];
  const meta = PERSONAS[persona];

  // Mermaid diagram composer — attach the markup to the chat (the agent reads it) or
  // append it into the current document.
  const [diagramOpen, setDiagramOpen] = useState(false);
  const diagramDocLabel =
    persona === "pm" ? "PRD"
    : persona === "architect" ? "architecture"
    : "UX spec";
  // Brownfield: guide the PM through analyzing the existing code before planning.
  const brownfieldOnboarding = persona === "pm" && isBrownfield && !projectContext.trim();
  function addDiagramToChat(src: string) {
    addAttachments([{ name: "app-flow.mmd", content: "```mermaid\n" + src + "\n```" }]);
  }
  function insertDiagramToDoc(src: string) {
    const block = "```mermaid\n" + src + "\n```\n";
    const apply = persona === "pm" ? setPrd : persona === "architect" ? setArchitecture : setUxSpec;
    apply(doc.trim() ? doc.replace(/\s*$/, "") + "\n\n" + block : block);
    setDiagramOpen(false);
  }
  const canApprove = prd.trim().length > 0 && architecture.trim().length > 0;
  const canSend = (draft.trim().length > 0 || attachments.length > 0) && planAuth.ready && !thinking;

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const docRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function exportDoc() {
    const el = docRef.current?.querySelector(".cadre-doc");
    if (el) exportHtmlToPdf(meta.file.replace(/^docs\//, "").replace(/\.md$/, ""), el.innerHTML);
  }

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
      try {
        const atts = await Promise.all(
          files.map(async (f) => ({ name: f.name || "pasted.md", content: await readFileText(f) }))
        );
        addAttachments(atts);
      } catch (err) {
        reportError("attach", err, { toastMessage: "Couldn't read the pasted file" });
      }
      return;
    }
    const text = dt.getData("text");
    const lines = text ? (text.match(/\n/g)?.length ?? 0) + 1 : 0;
    if (text && (text.length >= DOC_PASTE_MIN_CHARS || lines >= DOC_PASTE_MIN_LINES)) {
      e.preventDefault();
      addAttachments([{ name: guessName(text), content: text }]);
    }
  }

  // Explicit "attach file(s)" affordance — opens the native picker.
  function openFilePicker() {
    fileInputRef.current?.click();
  }

  // Read every picked file as text and attach it. Reset the input so picking
  // the same file twice in a row still fires a change event.
  async function onFilesPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const files = input.files ? Array.from(input.files) : [];
    input.value = "";
    if (!files.length) return;
    try {
      const atts = await Promise.all(
        files.map(async (f) => ({ name: f.name || "attachment.md", content: await readFileText(f) }))
      );
      addAttachments(atts);
    } catch (err) {
      reportError("attach", err, { toastMessage: "Couldn't read the attached file" });
    }
  }

  function systemPromptFor(id: PersonaId): string {
    if (id === "pm") {
      let p = PM_SYSTEM_PROMPT;
      // Brownfield: ground the PM in the existing-project analysis if we have it.
      if (projectContext.trim()) {
        p += `\n\n## Existing project analysis (this is a brownfield project — build on what exists)\n${projectContext}`;
      }
      // On re-entry with an existing PRD, the PM amends scope in place — new
      // requirements always flow through the PM (§5.1), not a loose story.
      if (prd.trim()) {
        p += `\n\n## Current PRD (amend this as new requirements or added scope arrive; always emit the FULL updated PRD via write_document)\n${prd}`;
      }
      return p;
    }
    const base = id === "architect" ? ARCHITECT_SYSTEM_PROMPT : DESIGN_SYSTEM_PROMPT;
    let p = prd.trim() ? `${base}\n\n## PRD (context)\n${prd}` : base;
    // Brownfield: every downstream specialist must design/plan to fit what already
    // exists, not just the PRD — the same as-is analysis the PM is grounded in.
    if (projectContext.trim()) {
      p += `\n\n## Existing project analysis (this is a brownfield project — build on what exists)\n${projectContext}`;
    }
    return p;
  }

  // `override` lets a quick-reply chip send its text directly.
  async function send(override?: string, target?: PersonaId) {
    const text = (override ?? draft).trim();
    if ((!text && attachments.length === 0) || thinking || !planAuth.ready) return;
    const auth = await resolvePlanningAuth(authProvider, dispatchUseLogin, secretGet);
    if (!auth.ready) { reportError("planning", new Error(auth.reason ?? "planning credential missing")); return; }
    const active = target ?? persona;
    // Routing to another persona (e.g. "solve gaps"): switch to it, keep it open,
    // and don't drag the current composer's attachments along.
    if (target && target !== persona) {
      setPersona(target);
      setHandedOff((h) => ({ ...h, [target]: true }));
    }
    const atts = target ? [] : attachments;
    // Resolve the doc setter from `active`, not the render-time persona — otherwise a
    // routed turn would write its updated document into the wrong pane.
    const applyDoc = active === "pm" ? setPrd : active === "architect" ? setArchitecture : setUxSpec;
    const base: ChatMessage[] = [
      ...threads[active],
      { role: "user", content: text, attachments: atts.length ? atts : undefined },
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
        apiKey: auth.apiKey,
        baseUrl: auth.baseUrl,
        model: planningModel,
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
      if (result.document) applyDoc(result.document);
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
      reportError("planning", e);
    } finally {
      setThinking(false);
      // Return focus to the composer so the user can keep typing immediately.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  const showDesignPreview = persona === "design" && designView === "preview";
  const prdReady = prd.trim().length > 0;
  // PM stays the lead (requirements first), but once the PRD exists the owner can
  // summon ANY specialist on demand — just click its tab to open a chat.
  const isOpen = (id: PersonaId) =>
    id === "pm" || prdReady || handedOff[id] || docFor(id).trim().length > 0;
  const architectOpen = isOpen("architect");

  // Next-step guidance — PM-mediated (the PM brings in the Architect).
  const guidance: { done: string | null; msg: string; to: PersonaId | null; cta: string } = !prdReady
    ? persona === "pm"
      ? { done: null, msg: "Start here — describe your idea and the PM will close down the requirements.", to: null, cta: "" }
      : { done: null, msg: "Everything starts with the PM.", to: "pm", cta: "Go to PM" }
    : persona === "architect"
      ? { done: "PRD ready", msg: "Design the build with the Architect — or summon the Designer from the tabs.", to: null, cta: "" }
      : persona === "design"
        ? { done: "PRD ready", msg: "Summon the Architect from the tabs, or approve when the architecture's ready.", to: "architect", cta: "Go to Architect" }
        : { done: "PRD ready", msg: "Requirements captured — chat with the Architect, or summon the Designer from the tabs.", to: "architect", cta: "Go to Architect" };

  // The PM hands off to the Architect only after the PRD is reviewed AND its findings resolved.
  const pmNeedsHandoff = persona === "pm" && prdReady && !architectOpen;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {diagramOpen && (
        <DiagramEditor
          docLabel={diagramDocLabel}
          onClose={() => setDiagramOpen(false)}
          onAddToChat={addDiagramToChat}
          onInsertToDoc={insertDiagramToDoc}
        />
      )}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Conversation */}
        <div style={{ width: `${split}%`, flexShrink: 0, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={paneHead}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--c-space-2)", flexWrap: "wrap" }}>
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
                  {reviews[id].status === "done" && reviews[id].result ? (
                    reviews[id].result.verdict === "accept" ? (
                      <ShieldCheck size={12} strokeWidth={2.5} style={{ color: "var(--c-success)" }} />
                    ) : (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 2, color: "var(--c-warning)", fontSize: "var(--c-fs-xs)", fontWeight: 600 as const }}>
                        <ShieldAlert size={12} strokeWidth={2.5} />
                        {reviews[id].result.findings.length}
                      </span>
                    )
                  ) : ready ? (
                    <Check size={12} strokeWidth={3} style={{ color: "var(--c-success)" }} />
                  ) : locked ? (
                    <Lock size={11} strokeWidth={2} />
                  ) : null}
                </button>
              );
            })}
            </div>
            {/* Active role's description, under the role names. */}
            <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)", paddingLeft: 2 }}>{meta.sub}</span>
          </div>

          {!planAuth.ready && (
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
              {planAuth.reason ? (
                <span style={{ flex: 1, fontSize: "var(--c-fs-sm)", color: "var(--c-text-secondary)" }}>{planAuth.reason}</span>
              ) : (
                <>
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
                </>
              )}
            </div>
          )}

          <div ref={scrollRef} style={{ flex: 1, overflow: "auto", padding: "var(--c-space-4)", display: "flex", flexDirection: "column" }}>
            {brownfieldOnboarding ? (
              <BrownfieldOnboard
                analyzing={analyzingBrownfield}
                output={brownfieldLog}
                onAnalyze={() => documentProject()}
                disabled={!planAuth.ready || !!busy}
              />
            ) : messages.length === 0 ? (
              <div style={{ margin: "auto 0" }}>
                {persona !== "pm" && prd.trim() && (
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      marginBottom: "var(--c-space-3)",
                      fontSize: "var(--c-fs-xs)",
                      fontWeight: 550 as const,
                      color: "var(--c-success)",
                      background: "var(--c-success-subtle)",
                      border: "1px solid var(--c-border)",
                      borderRadius: "var(--c-radius-full)",
                      padding: "3px 10px",
                    }}
                  >
                    <Check size={12} strokeWidth={3} /> PRD ready — working from it
                  </div>
                )}
                {persona === "pm" && projectContext.trim() && (
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      marginBottom: "var(--c-space-3)",
                      fontSize: "var(--c-fs-xs)",
                      fontWeight: 550 as const,
                      color: "var(--c-success)",
                      background: "var(--c-success-subtle)",
                      border: "1px solid var(--c-border)",
                      borderRadius: "var(--c-radius-full)",
                      padding: "3px 10px",
                    }}
                  >
                    <Check size={12} strokeWidth={3} /> Codebase analyzed — brief in context
                  </div>
                )}
                <p style={{ fontSize: "var(--c-fs-md)", lineHeight: 1.6, color: "var(--c-text-secondary)", maxWidth: 380 }}>
                  {persona === "pm" && projectContext.trim()
                    ? "I've read your codebase and written a project brief. Tell me what you want to change or add — I'll plan it against what's already there."
                    : persona !== "pm" && prd.trim()
                      ? persona === "architect"
                        ? "I've read the PRD — let's design the build."
                        : persona === "design"
                          ? "I've read the PRD — let's shape the UX and mock up the screens."
                          : meta.intro
                      : meta.intro}
                </p>
                <div style={{ fontSize: "var(--c-fs-xl)", fontWeight: 600 as const, marginTop: "var(--c-space-4)" }}>
                  {persona === "pm" && projectContext.trim() ? "What do you want to change or add?" : meta.opener}
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
            {tracker && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: "var(--c-space-2)" }}>
                <input
                  value={ticketRef}
                  onChange={(e) => setTicketRef(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void importFromTracker();
                    }
                  }}
                  placeholder="Ticket id (e.g. TCK-42)"
                  disabled={importingTicket}
                  aria-label="Ticket id to import"
                  style={{
                    flex: "0 1 180px",
                    background: "var(--c-surface-2)",
                    border: "1px solid var(--c-border)",
                    borderRadius: "var(--c-radius-sm)",
                    padding: "4px 8px",
                    fontSize: "var(--c-fs-xs)",
                    color: "var(--c-text)",
                    outline: "none",
                  }}
                />
                <button
                  onClick={() => void importFromTracker()}
                  disabled={importingTicket || !ticketRef.trim()}
                  title={`Import ticket from ${tracker.label}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    padding: "4px 10px",
                    borderRadius: "var(--c-radius-sm)",
                    background: "var(--c-surface-2)",
                    border: "1px solid var(--c-border)",
                    color: "var(--c-text-secondary)",
                    fontSize: "var(--c-fs-xs)",
                    cursor: importingTicket || !ticketRef.trim() ? "default" : "pointer",
                    opacity: importingTicket || !ticketRef.trim() ? 0.6 : 1,
                    flexShrink: 0,
                  }}
                >
                  {importingTicket ? (
                    <Loader2 size={12} strokeWidth={2.5} className="cadre-spin" />
                  ) : (
                    <Download size={12} strokeWidth={2.5} />
                  )}
                  Import from tracker
                </button>
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
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".md,.txt,.json,.ts,.tsx,.js,.jsx,.csv,.yml,.yaml,text/*"
                onChange={onFilesPicked}
                style={{ display: "none" }}
              />
              <button
                onClick={openFilePicker}
                disabled={!planAuth.ready || thinking}
                title="Attach one or more files"
                aria-label="Attach file"
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
                  cursor: planAuth.ready && !thinking ? "pointer" : "default",
                  opacity: planAuth.ready && !thinking ? 1 : 0.4,
                  flexShrink: 0,
                }}
              >
                <Paperclip size={16} strokeWidth={2} />
              </button>
              <button
                onClick={() => setDiagramOpen(true)}
                disabled={!planAuth.ready || thinking}
                title="Sketch an app flow as a Mermaid diagram for the agent to analyze"
                aria-label="Diagram"
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
                  cursor: planAuth.ready && !thinking ? "pointer" : "default",
                  opacity: planAuth.ready && !thinking ? 1 : 0.4,
                  flexShrink: 0,
                }}
              >
                <Workflow size={16} strokeWidth={2} />
              </button>
              <textarea
                ref={inputRef}
                value={draft}
                rows={1}
                onChange={(e) => setDraft(e.target.value)}
                onPaste={onPaste}
                onKeyDown={onInputKeyDown}
                placeholder={planAuth.ready ? `Talk to the ${meta.label}…  (Enter to send · Shift+Enter for a new line · 📎 or paste to attach a file)` : (planAuth.reason ?? "Add your API key above to start")}
                disabled={!planAuth.ready}
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

        {/* Draggable divider */}
        <div
          className="cadre-divider"
          onMouseDown={onDividerDown}
          title="Drag to resize"
          style={{ width: 7, flexShrink: 0, cursor: "col-resize", display: "flex", alignItems: "stretch", justifyContent: "center" }}
        >
          <div className="cadre-divider-line" style={{ width: 1, background: "var(--c-border)" }} />
        </div>

        {/* Live document / mockup */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--c-bg)", minWidth: 0 }}>
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
            {!showDesignPreview && doc.trim() && (
              <button
                onClick={runReview}
                disabled={review.status === "reviewing"}
                title="Run an adversarial same-role review of this artifact"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: "var(--c-fs-xs)",
                  color: review.status === "reviewing" ? "var(--c-text-muted)" : "var(--c-text-secondary)",
                  background: "transparent",
                  border: "1px solid var(--c-border)",
                  borderRadius: "var(--c-radius-sm)",
                  padding: "3px 8px",
                  cursor: review.status === "reviewing" ? "default" : "pointer",
                }}
              >
                <Gavel size={12} strokeWidth={2} />
                {review.status === "reviewing" ? "Reviewing…" : "Review"}
              </button>
            )}
            {!showDesignPreview && doc.trim() && (
              <button
                onClick={exportDoc}
                title="Export this document to PDF"
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
            <div ref={docRef} style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "var(--c-space-5)" }}>
              <Markdown className="cadre-doc" content={doc} />
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

          {!showDesignPreview && review.status !== "idle" && (
            <ReviewPanel state={review} label={meta.label} onResolve={resolveFinding} />
          )}
        </div>
      </div>

      {/* Approve gate */}
      {error && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--c-space-2)",
            padding: "6px var(--c-space-4)",
            background: "var(--c-danger-subtle)",
            borderTop: "1px solid var(--c-border)",
            color: "var(--c-danger)",
            fontSize: "var(--c-fs-sm)",
          }}
        >
          <AlertTriangle size={13} strokeWidth={2} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{error}</span>
          <button
            onClick={clearError}
            title="Dismiss"
            style={{ background: "transparent", border: "none", color: "var(--c-danger)", cursor: "pointer", display: "inline-flex", padding: 0 }}
          >
            <X size={13} strokeWidth={2} />
          </button>
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
            {busy ? <Loader2 size={13} strokeWidth={2.5} className="cadre-spin" /> : <RefreshCw size={13} strokeWidth={2} />}
            {busy ? "Applying…" : "Apply changes"}
          </button>
          <button
            onClick={() => approvePlan(verification.length ? verification : [verifyCmd])}
            disabled={!!busy}
            className={!busy ? "cadre-btn-primary" : undefined}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: "var(--c-fs-sm)",
              fontWeight: 550 as const,
              padding: "5px 12px",
              borderRadius: "var(--c-radius)",
              background: busy ? "var(--c-surface-3)" : undefined,
              color: busy ? "var(--c-text-muted)" : undefined,
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
        <>
          {poCheck.status !== "idle" && (
            <PoValidationPanel state={poCheck} onSolve={solveGaps} solving={thinking} />
          )}
          {/* Multi-repo: per-repo verify inputs shown above the sign-off bar */}
          {multiRepo && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                padding: "8px var(--c-space-4)",
                background: "var(--c-surface-1)",
                borderTop: "1px solid var(--c-border)",
                flexShrink: 0,
              }}
            >
              <div style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-muted)", fontWeight: 600 as const }}>
                Per-repo verify commands — required for approval
              </div>
              {repos.map((repo) => {
                const v = repoVerifyDrafts[repo.id] ?? repo.verify ?? "";
                const missing = !v.trim();
                return (
                  <div key={repo.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        fontSize: "var(--c-fs-xs)",
                        fontFamily: "var(--c-font-mono)",
                        fontWeight: 600 as const,
                        color: missing ? "var(--c-danger)" : "var(--c-text-secondary)",
                        background: missing ? "var(--c-danger-subtle)" : "var(--c-surface-2)",
                        border: `1px solid ${missing ? "var(--c-danger)" : "var(--c-border)"}`,
                        borderRadius: "var(--c-radius-full)",
                        padding: "1px 8px",
                        flexShrink: 0,
                        minWidth: 60,
                        textAlign: "center" as const,
                      }}
                    >
                      {repo.id}
                    </span>
                    <input
                      value={v}
                      onChange={(e) => {
                        const val = e.target.value;
                        setRepoVerifyDrafts((d) => ({ ...d, [repo.id]: val }));
                        // Persist immediately so approvePlan picks up the latest values
                        if (projectRootForRepos) setRepoVerify(projectRootForRepos, repo.id, val);
                      }}
                      placeholder={`verify command for "${repo.name || repo.id}"`}
                      style={{
                        flex: 1,
                        minWidth: 80,
                        background: "var(--c-surface-1)",
                        border: `1px solid ${missing ? "var(--c-danger)" : "var(--c-border-strong)"}`,
                        borderRadius: "var(--c-radius)",
                        outline: "none",
                        color: "var(--c-text)",
                        fontSize: "var(--c-fs-sm)",
                        fontFamily: "var(--c-font-mono)",
                        padding: "4px 9px",
                      }}
                    />
                    {missing && (
                      <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-danger)", flexShrink: 0 }}>
                        required
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
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
              {multiRepo ? "Global verify (main repo):" : "CTO sign-off — verify against:"}
            </span>
            <input
              value={verifyCmd}
              onChange={(e) => {
                verifyTouched.current = true;
                setVerifyCmd(e.target.value);
                setVerifySuggested(false);
              }}
              placeholder="e.g. npm test · pytest · cargo test · make verify"
              style={{
                flex: 1,
                minWidth: 100,
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
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "var(--c-fs-xs)", color: "var(--c-accent)", flexShrink: 0 }}>
                <Ruler size={11} strokeWidth={2} /> Architect's
              </span>
            )}
            <button
              onClick={runPoValidation}
              disabled={poCheck.status === "reviewing" || !!busy}
              title="Adversarial validation of the whole plan (coverage, testable ACs, gaps) to back your sign-off"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: "var(--c-fs-sm)",
                fontWeight: 550 as const,
                padding: "5px 12px",
                borderRadius: "var(--c-radius)",
                background: "var(--c-surface-2)",
                color: "var(--c-text)",
                border: "1px solid var(--c-border-strong)",
                cursor: poCheck.status === "reviewing" ? "default" : "pointer",
                flexShrink: 0,
              }}
            >
              <ClipboardCheck size={13} strokeWidth={2} />
              {poCheck.status === "reviewing" ? "Validating…" : "Validate plan"}
            </button>
            {(() => {
              // Multi-repo gate: every registered repo needs a non-empty verify command.
              const missingRepo = multiRepo
                ? repos.find((r) => !(repoVerifyDrafts[r.id] ?? r.verify ?? "").trim())
                : null;
              const canSign = !busy && verifyCmd.trim() && !missingRepo;
              return (
                <>
                  {missingRepo && (
                    <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-danger)", flexShrink: 0 }}>
                      Set a verify command for &quot;{missingRepo.name || missingRepo.id}&quot;
                    </span>
                  )}
                  <button
                    onClick={() => approvePlan([verifyCmd])}
                    disabled={!canSign}
                    className={canSign ? "cadre-btn-primary" : undefined}
                    title={missingRepo ? `Set a verify command for "${missingRepo.name || missingRepo.id}" first` : "Sign off on the plan"}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      fontSize: "var(--c-fs-sm)",
                      fontWeight: 550 as const,
                      padding: "6px 14px",
                      borderRadius: "var(--c-radius)",
                      background: canSign ? undefined : "var(--c-surface-3)",
                      color: canSign ? undefined : "var(--c-text-muted)",
                      border: "none",
                      cursor: canSign ? "pointer" : "default",
                      flexShrink: 0,
                    }}
                  >
                    {busy ? (
                      <>
                        <Loader2 size={13} strokeWidth={2.5} className="cadre-spin" /> Signing off…
                      </>
                    ) : (
                      "Sign off & dispatch"
                    )}
                  </button>
                </>
              );
            })()}
          </div>
        </>
      ) : pmNeedsHandoff ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--c-space-2)",
            padding: "9px var(--c-space-4)",
            background: reviewResolved ? "var(--c-success-subtle)" : "var(--c-surface-1)",
            borderTop: "1px solid var(--c-border)",
            fontSize: "var(--c-fs-sm)",
            flexShrink: 0,
          }}
        >
          <Gavel size={14} strokeWidth={2} style={{ color: "var(--c-accent)", flexShrink: 0 }} />
          <span style={{ color: "var(--c-text-secondary)" }}>
            {review.status !== "done"
              ? "Have the PRD adversarially reviewed before handing off."
              : !reviewResolved
                ? "Resolve every review finding above (confirm or comment) to hand off."
                : "Reviewed & resolved — hand off to the Architect."}
          </span>
          <div style={{ flex: 1 }} />
          {review.status !== "done" ? (
            <button
              onClick={runReview}
              disabled={review.status === "reviewing"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: "var(--c-fs-sm)",
                fontWeight: 550 as const,
                padding: "5px 12px",
                borderRadius: "var(--c-radius)",
                background: "var(--c-surface-2)",
                color: "var(--c-text)",
                border: "1px solid var(--c-border-strong)",
                cursor: review.status === "reviewing" ? "default" : "pointer",
                flexShrink: 0,
              }}
            >
              <Gavel size={13} strokeWidth={2} />
              {review.status === "reviewing" ? "Reviewing…" : "Review the PRD"}
            </button>
          ) : (
            <button
              onClick={() => handoffTo("architect")}
              disabled={!reviewResolved}
              title={reviewResolved ? "Bring in the Architect" : "Resolve the findings first"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: "var(--c-fs-sm)",
                fontWeight: 550 as const,
                padding: "5px 12px",
                borderRadius: "var(--c-radius)",
                background: reviewResolved ? "var(--c-accent)" : "var(--c-surface-3)",
                color: reviewResolved ? "var(--c-on-accent)" : "var(--c-text-muted)",
                border: "none",
                cursor: reviewResolved ? "pointer" : "default",
                flexShrink: 0,
              }}
            >
              Hand off to Architect
              <ArrowRight size={13} strokeWidth={2.5} />
            </button>
          )}
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

function sevColor(sev: Severity): string {
  return sev === "blocker" ? "var(--c-danger)" : sev === "major" ? "var(--c-warning)" : "var(--c-text-muted)";
}

/** The adversarial reviewer's verdict + findings; the user confirms or comments each to resolve it. */
function ReviewPanel({
  state,
  label,
  onResolve,
}: {
  state: {
    status: "idle" | "reviewing" | "done";
    result?: ReviewResult;
    resolutions?: Record<number, { action: "confirmed" | "commented"; comment?: string }>;
  };
  label: string;
  onResolve: (index: number, action: "confirmed" | "commented", comment?: string) => void;
}) {
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  if (state.status === "reviewing") {
    return (
      <div
        style={{
          flexShrink: 0,
          borderTop: "1px solid var(--c-border)",
          background: "var(--c-surface-1)",
          padding: "10px var(--c-space-5)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ color: "var(--c-accent)" }}>
          <Dots />
        </span>
        <span style={{ fontSize: "var(--c-fs-sm)", color: "var(--c-text-muted)" }}>
          The adversarial {label} is reviewing this artifact…
        </span>
      </div>
    );
  }
  const r = state.result;
  if (!r) return null;
  const blocked = r.verdict === "block";
  const resolutions = state.resolutions ?? {};
  const unresolved = r.findings.filter((_, i) => !resolutions[i]).length;
  return (
    <div
      style={{
        flexShrink: 0,
        borderTop: "1px solid var(--c-border)",
        background: "var(--c-surface-1)",
        maxHeight: 280,
        overflow: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px var(--c-space-5)",
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
          {blocked ? `Blocked · ${r.findings.length} finding${r.findings.length === 1 ? "" : "s"}` : "Accepted"}
        </span>
        <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>adversarial {label} review</span>
        <div style={{ flex: 1 }} />
        {r.findings.length > 0 && (
          <span style={{ fontSize: "var(--c-fs-xs)", fontWeight: 550 as const, color: unresolved === 0 ? "var(--c-success)" : "var(--c-warning)" }}>
            {unresolved === 0 ? "all resolved" : `${unresolved} to resolve`}
          </span>
        )}
      </div>
      {r.findings.length > 0 && (
        <div style={{ padding: "var(--c-space-3) var(--c-space-5)", display: "flex", flexDirection: "column", gap: 14 }}>
          {r.findings.map((f, i) => {
            const res = resolutions[i];
            return (
              <div key={i} style={{ display: "flex", gap: 8, opacity: res ? 0.72 : 1 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: sevColor(f.severity), marginTop: 6, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "var(--c-fs-sm)", color: "var(--c-text)" }}>
                    <span style={{ textTransform: "uppercase", fontSize: 9, letterSpacing: "0.06em", color: sevColor(f.severity), marginRight: 6, fontWeight: 600 as const }}>
                      {f.severity}
                    </span>
                    {f.title}
                  </div>
                  <div style={{ fontSize: "var(--c-fs-sm)", color: "var(--c-text-muted)", lineHeight: 1.5 }}>{f.detail}</div>
                  {res ? (
                    <div style={{ marginTop: 5, display: "inline-flex", alignItems: "center", gap: 5, fontSize: "var(--c-fs-xs)", color: res.action === "confirmed" ? "var(--c-success)" : "var(--c-text-secondary)" }}>
                      <Check size={11} strokeWidth={2.5} />
                      {res.action === "confirmed" ? "Confirmed — will address" : `Commented: ${res.comment}`}
                    </div>
                  ) : (
                    <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
                      <button onClick={() => onResolve(i, "confirmed")} style={resolveBtn(true)}>
                        <Check size={11} strokeWidth={2.5} /> Confirm
                      </button>
                      <input
                        value={drafts[i] ?? ""}
                        onChange={(e) => setDrafts((d) => ({ ...d, [i]: e.target.value }))}
                        onKeyDown={(e) => {
                          const c = (drafts[i] ?? "").trim();
                          if (e.key === "Enter" && c) onResolve(i, "commented", c);
                        }}
                        placeholder="or comment to resolve…"
                        style={{
                          flex: 1,
                          minWidth: 80,
                          background: "var(--c-surface-2)",
                          border: "1px solid var(--c-border)",
                          borderRadius: "var(--c-radius-sm)",
                          outline: "none",
                          color: "var(--c-text)",
                          fontSize: "var(--c-fs-xs)",
                          padding: "3px 8px",
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function resolveBtn(primary: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: "var(--c-fs-xs)",
    fontWeight: 550 as const,
    padding: "3px 9px",
    borderRadius: "var(--c-radius-sm)",
    background: primary ? "var(--c-surface-3)" : "transparent",
    color: "var(--c-text-secondary)",
    border: "1px solid var(--c-border)",
    cursor: "pointer",
    flexShrink: 0,
  };
}

/** The adversarial PO validation of the whole plan — read-only; you (the human PO) sign off. */
const SOLVE_TARGETS: { id: PersonaId; label: string }[] = [
  { id: "pm", label: "PM" },
  { id: "architect", label: "Architect" },
  { id: "design", label: "Designer" },
];

function PoValidationPanel({
  state,
  onSolve,
  solving,
}: {
  state: { status: "idle" | "reviewing" | "done"; result?: ReviewResult };
  onSolve: (target: PersonaId, gaps: Finding[]) => void;
  solving: boolean;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [target, setTarget] = useState<PersonaId>("architect");
  const toggle = (i: number) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  if (state.status === "reviewing") {
    return (
      <div style={{ flexShrink: 0, borderTop: "1px solid var(--c-border)", background: "var(--c-surface-1)", padding: "10px var(--c-space-4)", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: "var(--c-accent)" }}>
          <Dots />
        </span>
        <span style={{ fontSize: "var(--c-fs-sm)", color: "var(--c-text-muted)" }}>
          Validating the whole plan for your sign-off…
        </span>
      </div>
    );
  }
  const r = state.result;
  if (!r) return null;
  const blocked = r.verdict === "block";
  return (
    <div style={{ flexShrink: 0, borderTop: "1px solid var(--c-border)", background: "var(--c-surface-1)", maxHeight: 220, overflow: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px var(--c-space-4)", position: "sticky", top: 0, background: "var(--c-surface-1)", borderBottom: "1px solid var(--c-border)" }}>
        <ClipboardCheck size={14} strokeWidth={2} style={{ color: blocked ? "var(--c-warning)" : "var(--c-success)", flexShrink: 0 }} />
        <span style={{ fontSize: "var(--c-fs-sm)", fontWeight: 600 as const, color: blocked ? "var(--c-warning)" : "var(--c-success)" }}>
          {blocked ? `Plan validation · ${r.findings.length} gap${r.findings.length === 1 ? "" : "s"}` : "Plan validation · clean"}
        </span>
        {r.summary && (
          <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            — {r.summary}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {r.findings.length > 0 ? (
          <button
            onClick={() => setSelected((s) => (s.size === r.findings.length ? new Set() : new Set(r.findings.map((_, i) => i))))}
            style={{ background: "none", border: "none", color: "var(--c-accent)", fontSize: "var(--c-fs-xs)", cursor: "pointer", padding: 0 }}
          >
            {selected.size === r.findings.length ? "Clear all" : "Select all"}
          </button>
        ) : (
          <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>you decide — CTO signs off below</span>
        )}
      </div>
      {r.findings.length > 0 && (
        <div style={{ padding: "var(--c-space-3) var(--c-space-4)", display: "flex", flexDirection: "column", gap: 4 }}>
          {r.findings.map((f, i) => (
            <label
              key={i}
              style={{
                display: "flex",
                gap: 9,
                alignItems: "flex-start",
                padding: "6px 8px",
                borderRadius: "var(--c-radius)",
                cursor: "pointer",
                background: selected.has(i) ? "var(--c-surface-2)" : "transparent",
              }}
            >
              <input
                type="checkbox"
                checked={selected.has(i)}
                onChange={() => toggle(i)}
                style={{ marginTop: 3, accentColor: "var(--c-accent)", cursor: "pointer", flexShrink: 0 }}
              />
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: sevColor(f.severity), marginTop: 6, flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: "var(--c-fs-sm)", color: "var(--c-text)" }}>
                  <span style={{ textTransform: "uppercase", fontSize: 9, letterSpacing: "0.06em", color: sevColor(f.severity), marginRight: 6, fontWeight: 600 as const }}>
                    {f.severity}
                  </span>
                  {f.title}
                </div>
                <div style={{ fontSize: "var(--c-fs-sm)", color: "var(--c-text-muted)", lineHeight: 1.5 }}>{f.detail}</div>
              </div>
            </label>
          ))}
        </div>
      )}
      {selected.size > 0 && (
        <div
          style={{
            position: "sticky",
            bottom: 0,
            display: "flex",
            alignItems: "center",
            gap: "var(--c-space-2)",
            padding: "8px var(--c-space-4)",
            background: "var(--c-surface-2)",
            borderTop: "1px solid var(--c-border)",
          }}
        >
          <span style={{ fontSize: "var(--c-fs-sm)", color: "var(--c-text-secondary)", flexShrink: 0 }}>
            {selected.size} gap{selected.size === 1 ? "" : "s"} → send to
          </span>
          <div style={{ display: "flex", gap: 2, background: "var(--c-surface-1)", border: "1px solid var(--c-border-strong)", borderRadius: "var(--c-radius)", padding: 2 }}>
            {SOLVE_TARGETS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTarget(t.id)}
                style={{
                  fontSize: "var(--c-fs-xs)",
                  fontWeight: 550 as const,
                  padding: "3px 10px",
                  borderRadius: "calc(var(--c-radius) - 2px)",
                  border: "none",
                  cursor: "pointer",
                  background: target === t.id ? "var(--c-accent)" : "transparent",
                  color: target === t.id ? "var(--c-on-accent)" : "var(--c-text-muted)",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => {
              const gaps = r.findings.filter((_, i) => selected.has(i));
              onSolve(target, gaps);
              setSelected(new Set());
            }}
            disabled={solving}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: "var(--c-fs-sm)",
              fontWeight: 600 as const,
              padding: "6px 14px",
              borderRadius: "var(--c-radius)",
              background: solving ? "var(--c-surface-3)" : "var(--c-accent)",
              color: solving ? "var(--c-text-muted)" : "var(--c-on-accent)",
              border: "none",
              cursor: solving ? "default" : "pointer",
              flexShrink: 0,
            }}
          >
            <Wrench size={13} strokeWidth={2} />
            {solving ? "Sending…" : `Solve ${selected.size}`}
          </button>
        </div>
      )}
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
