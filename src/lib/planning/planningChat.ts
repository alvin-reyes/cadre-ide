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

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface PlanningTurnResult {
  reply: string;
  /** present if the persona updated the document this turn */
  document?: string;
}

export async function planningTurn(opts: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: ChatMessage[];
}): Promise<PlanningTurnResult> {
  const client = new Anthropic({
    apiKey: opts.apiKey,
    dangerouslyAllowBrowser: true,
  });

  const response = await client.messages.create({
    model: opts.model,
    max_tokens: 4096,
    system: opts.systemPrompt,
    tools: [WRITE_DOCUMENT_TOOL],
    messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
  });

  let reply = "";
  let document: string | undefined;
  for (const block of response.content) {
    if (block.type === "text") {
      reply += block.text;
    } else if (block.type === "tool_use" && block.name === "write_document") {
      const input = block.input as { markdown?: string };
      if (typeof input.markdown === "string") document = input.markdown;
    }
  }

  return { reply: reply.trim(), document };
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
