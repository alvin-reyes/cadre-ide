import Anthropic from "@anthropic-ai/sdk";

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
  /** short quick-reply suggestions the user can tap instead of typing */
  suggestions?: string[];
}

export async function planningTurn(opts: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: ChatMessage[];
  /** allow the persona to emit an HTML mockup (Design tab) */
  allowMockup?: boolean;
}): Promise<PlanningTurnResult> {
  const client = new Anthropic({
    apiKey: opts.apiKey,
    dangerouslyAllowBrowser: true,
  });

  const tools = [
    WRITE_DOCUMENT_TOOL,
    ...(opts.allowMockup ? [WRITE_MOCKUP_TOOL] : []),
    SUGGEST_REPLIES_TOOL,
  ] as Anthropic.Tool[];

  const response = await client.messages.create({
    model: opts.model,
    max_tokens: 4096,
    system: opts.systemPrompt,
    tools,
    messages: opts.messages.map((m) => ({ role: m.role, content: toApiContent(m) })),
  });

  let reply = "";
  let document: string | undefined;
  let mockup: string | undefined;
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
    } else if (block.type === "tool_use" && block.name === "suggest_replies") {
      const input = block.input as { replies?: unknown };
      if (Array.isArray(input.replies)) {
        suggestions = input.replies.filter((r): r is string => typeof r === "string").slice(0, 4);
      }
    }
  }

  return { reply: reply.trim(), document, mockup, suggestions };
}

/** Force a single tool call (used by the SM's create_story). Returns the tool input. */
export async function callTool(opts: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  tool: unknown;
}): Promise<unknown> {
  const client = new Anthropic({
    apiKey: opts.apiKey,
    dangerouslyAllowBrowser: true,
  });
  const tool = opts.tool as Anthropic.Tool;
  const response = await client.messages.create({
    model: opts.model,
    max_tokens: 4096,
    system: opts.systemPrompt,
    tools: [tool],
    tool_choice: { type: "tool", name: tool.name },
    messages: [{ role: "user", content: opts.userPrompt }],
  });
  for (const block of response.content) {
    if (block.type === "tool_use") return block.input;
  }
  throw new Error("model did not call the tool");
}
