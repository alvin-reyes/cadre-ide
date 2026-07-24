import Anthropic from "@anthropic-ai/sdk";
import { recordUsage } from "../../stores/usageStore";

/**
 * Construct an Anthropic SDK client. When `baseUrl` is provided it is forwarded
 * as `baseURL` so calls target an Anthropic-compatible third-party endpoint
 * (e.g. Kimi, DeepSeek). When omitted the client defaults to the native
 * Anthropic base URL — identical behaviour to before this helper existed.
 */
export function makeAnthropic(apiKey: string, baseUrl?: string): Anthropic {
  return new Anthropic({
    apiKey,
    ...(baseUrl ? { baseURL: baseUrl } : {}),
    dangerouslyAllowBrowser: true,
  });
}

/**
 * If the configured model id doesn't resolve on the account, fall back once to a
 * known-good DATED id of the same tier (Opus→Opus, Sonnet→Sonnet). Keeps calls
 * alive despite model-alias drift.
 */
export function fallbackModel(model: string): string {
  return model.toLowerCase().includes("opus")
    ? "claude-opus-4-20250514"
    : "claude-sonnet-4-20250514";
}
export function isModelError(e: unknown): boolean {
  const s = String((e as { message?: string })?.message ?? e).toLowerCase();
  return (
    s.includes("model") &&
    (s.includes("not_found") ||
      s.includes("not found") ||
      s.includes("404") ||
      s.includes("does not exist") ||
      s.includes("invalid model"))
  );
}

/**
 * The Planning Studio's live SDK binding. The PM/Architect persona converses
 * with the user and, via the write_document tool, produces the artifact
 * (prd.md / architecture.md) that forms in the live-document pane.
 */
export const WRITE_DOCUMENT_TOOL = {
  name: "write_document" as const,
  description:
    "Write or update the current document. Call this whenever the document should change, passing the FULL current document as Markdown (not a diff).",
  input_schema: {
    type: "object" as const,
    properties: {
      markdown: {
        type: "string" as const,
        description: "The complete document in Markdown.",
      },
    },
    required: ["markdown"],
  },
};

export interface Attachment {
  name: string;
  content: string;
}

/** The Design persona emits a self-contained HTML mockup (rendered in a sandboxed iframe). */
export const WRITE_MOCKUP_TOOL = {
  name: "write_mockup" as const,
  description:
    "Write or update a self-contained HTML mockup of the UI. Inline all CSS in a <style> tag; use NO external resources, scripts, or network fonts. Call this whenever the visual design should change, passing the FULL HTML document.",
  input_schema: {
    type: "object" as const,
    properties: {
      html: {
        type: "string" as const,
        description: "A complete, self-contained HTML document (inline CSS only).",
      },
    },
    required: ["html"],
  },
};

/** The Architect proposes the shell command Cadre should verify every story against. */
export const SUGGEST_VERIFICATION_TOOL = {
  name: "suggest_verification" as const,
  description:
    "Propose the single shell command Cadre should run to verify each story is done (e.g. 'npm test', 'pnpm test', 'cargo test'). Call this once the testing strategy is clear so the user can just confirm it.",
  input_schema: {
    type: "object" as const,
    properties: {
      command: {
        type: "string" as const,
        description: "One shell command that exits 0 on success (the verification gate).",
      },
    },
    required: ["command"],
  },
};

/** The PM orchestrates: it brings in the Architect / Designer / PO. Users reach them only through the PM. */
export const HANDOFF_TOOL = {
  name: "handoff" as const,
  description:
    "Bring in the next specialist. Call this to hand off — the Analyst for discovery/research, the Architect when the PRD is solid and it's time to design the build, the Designer for UX, or the Technical Writer for documentation.",
  input_schema: {
    type: "object" as const,
    properties: {
      role: {
        type: "string" as const,
        enum: ["analyst", "architect", "design", "techwriter"],
        description: "which specialist to bring in",
      },
      note: { type: "string" as const, description: "one short line on what they should focus on" },
    },
    required: ["role"],
  },
};

/** Any persona may offer short quick-reply suggestions so the user can answer with one click. */
export const SUGGEST_REPLIES_TOOL = {
  name: "suggest_replies" as const,
  description:
    "Offer 2-4 short suggested replies (max ~6 words each) the user can tap instead of typing. Use when a concrete choice or confirmation would move things forward.",
  input_schema: {
    type: "object" as const,
    properties: {
      replies: {
        type: "array" as const,
        items: { type: "string" as const },
        description: "2-4 short suggested user replies.",
      },
    },
    required: ["replies"],
  },
};

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** documents pasted/attached to this turn; folded into the content the model sees */
  attachments?: Attachment[];
}

/** The text actually sent to the model: attached docs as fenced blocks, then the message. */
export function toApiContent(m: ChatMessage): string {
  if (!m.attachments || m.attachments.length === 0) return m.content;
  const blocks = m.attachments.map(
    (a) => `<attached-document name="${a.name}">\n${a.content}\n</attached-document>`
  );
  return [...blocks, m.content].filter((s) => s.length > 0).join("\n\n");
}

export interface PlanningTurnResult {
  reply: string;
  /** present if the persona updated the document this turn */
  document?: string;
  /** present if the Design persona produced/updated an HTML mockup */
  mockup?: string;
  /** present if the Architect proposed the verification command */
  verification?: string;
  /** set when the PM hands off ("analyst" | "architect" | "design" | "techwriter") */
  handoff?: string;
  /** short quick-reply suggestions the user can tap instead of typing */
  suggestions?: string[];
}

export async function planningTurn(opts: {
  apiKey: string;
  /** optional provider base URL (e.g. Kimi / DeepSeek Anthropic-compatible endpoint) */
  baseUrl?: string;
  model: string;
  systemPrompt: string;
  messages: ChatMessage[];
  /** allow the persona to emit an HTML mockup (Design tab) */
  allowMockup?: boolean;
  /** allow the persona to propose the verification command (Architect) */
  allowVerification?: boolean;
  /** allow the persona to hand off to the next role (PM only) */
  allowHandoff?: boolean;
  /** streamed assistant text deltas (Claude-style progressive rendering) */
  onText?: (delta: string) => void;
}): Promise<PlanningTurnResult> {
  const client = makeAnthropic(opts.apiKey, opts.baseUrl);

  const tools = [
    WRITE_DOCUMENT_TOOL,
    ...(opts.allowMockup ? [WRITE_MOCKUP_TOOL] : []),
    ...(opts.allowVerification ? [SUGGEST_VERIFICATION_TOOL] : []),
    ...(opts.allowHandoff ? [HANDOFF_TOOL] : []),
    SUGGEST_REPLIES_TOOL,
  ] as Anthropic.Tool[];

  const apiMessages = opts.messages.map((m) => ({ role: m.role, content: toApiContent(m) }));
  const runStream = (model: string) => {
    const stream = client.messages.stream({
      model,
      max_tokens: 4096,
      system: opts.systemPrompt,
      tools,
      messages: apiMessages,
    });
    if (opts.onText) {
      const onText = opts.onText;
      stream.on("text", (delta: string) => onText(delta));
    }
    return stream.finalMessage();
  };

  let usedModel = opts.model;
  let response: Anthropic.Message;
  try {
    response = await runStream(opts.model);
  } catch (e) {
    if (isModelError(e) && opts.model !== fallbackModel(opts.model)) {
      const fb = fallbackModel(opts.model);
      usedModel = fb;
      response = await runStream(fb);
    } else {
      throw e;
    }
  }
  recordUsage(response.usage, usedModel);

  let reply = "";
  let document: string | undefined;
  let mockup: string | undefined;
  let verification: string | undefined;
  let handoff: string | undefined;
  let suggestions: string[] | undefined;
  for (const block of response.content) {
    if (block.type === "text") {
      reply += block.text;
    } else if (block.type === "tool_use" && block.name === "write_document") {
      const input = block.input as { markdown?: string };
      if (typeof input.markdown === "string") document = input.markdown;
    } else if (block.type === "tool_use" && block.name === "write_mockup") {
      const input = block.input as { html?: string };
      if (typeof input.html === "string") mockup = input.html;
    } else if (block.type === "tool_use" && block.name === "suggest_verification") {
      const input = block.input as { command?: string };
      if (typeof input.command === "string" && input.command.trim()) verification = input.command.trim();
    } else if (block.type === "tool_use" && block.name === "handoff") {
      const input = block.input as { role?: string };
      // Accept every role the HANDOFF_TOOL enum offers — dropping analyst/techwriter
      // here made those PM hand-offs silent no-ops.
      if (
        input.role === "analyst" ||
        input.role === "architect" ||
        input.role === "design" ||
        input.role === "techwriter"
      ) {
        handoff = input.role;
      }
    } else if (block.type === "tool_use" && block.name === "suggest_replies") {
      const input = block.input as { replies?: unknown };
      if (Array.isArray(input.replies)) {
        suggestions = input.replies.filter((r): r is string => typeof r === "string").slice(0, 4);
      }
    }
  }

  return { reply: reply.trim(), document, mockup, verification, handoff, suggestions };
}

/** Force a single tool call (used by the SM's create_story). Returns the tool input. */
export async function callTool(opts: {
  apiKey: string;
  /** optional provider base URL (e.g. Kimi / DeepSeek Anthropic-compatible endpoint) */
  baseUrl?: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  tool: unknown;
}): Promise<unknown> {
  const client = makeAnthropic(opts.apiKey, opts.baseUrl);
  const tool = opts.tool as Anthropic.Tool;
  const runCreate = (model: string) =>
    client.messages.create({
      model,
      max_tokens: 4096,
      system: opts.systemPrompt,
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
      messages: [{ role: "user", content: opts.userPrompt }],
    });
  let usedModel = opts.model;
  let response: Anthropic.Message;
  try {
    response = await runCreate(opts.model);
  } catch (e) {
    if (isModelError(e) && opts.model !== fallbackModel(opts.model)) {
      const fb = fallbackModel(opts.model);
      usedModel = fb;
      response = await runCreate(fb);
    } else {
      throw e;
    }
  }
  recordUsage(response.usage, usedModel);
  for (const block of response.content) {
    if (block.type === "tool_use") return block.input;
  }
  throw new Error("model did not call the tool");
}
