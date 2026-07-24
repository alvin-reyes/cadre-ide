import { makeAnthropic, fallbackModel, isModelError, type ChatMessage } from "./planningChat";
import { ORCHESTRATOR_TOOLS } from "./orchestratorTools";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface OrchestratorTurnOpts {
  apiKey: string;
  baseUrl?: string;
  model: string;
  systemPrompt: string;
  messages: ChatMessage[];
  onText: (delta: string) => void;
  /** Run a tool; returns the outcome fed back to the model. */
  onToolCall: (name: string, input: unknown) => Promise<{ ok: boolean; message: string }>;
  /** Notify the UI a tool is about to run / finished (for inline rendering). */
  onToolEvent?: (e: {
    name: string;
    input: unknown;
    phase: "start" | "done";
    ok?: boolean;
    message?: string;
  }) => void;
  maxIterations?: number; // default 8
  signal?: AbortSignal;
}

export interface OrchestratorTurnResult {
  reply: string;
}

// ---------------------------------------------------------------------------
// Minimal structural type for the injectable client seam
// ---------------------------------------------------------------------------

interface StreamLike {
  on(event: string, cb: (delta: string) => void): StreamLike;
  finalMessage(): Promise<{
    content: ContentBlock[];
    stop_reason: string;
    usage?: { input_tokens: number; output_tokens: number };
  }>;
}

export interface ContentBlock {
  type: string;
  id?: string;
  name?: string;
  input?: unknown;
  text?: string;
}

interface ClientLike {
  messages: {
    stream(params: {
      model: string;
      system: string;
      tools: unknown[];
      messages: unknown[];
      max_tokens: number;
      signal?: AbortSignal;
    }): StreamLike;
  };
}

// ---------------------------------------------------------------------------
// Working message shapes (what we accumulate during the loop)
// ---------------------------------------------------------------------------

interface TextContentBlock {
  type: "text";
  text: string;
}

interface ToolUseContentBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

interface ToolResultContentBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error: boolean;
}

type WorkingContent = TextContentBlock | ToolUseContentBlock | ToolResultContentBlock;

interface WorkingMessage {
  role: "user" | "assistant";
  content: string | WorkingContent[];
}

// ---------------------------------------------------------------------------
// Pure loop — injectable for testing
// ---------------------------------------------------------------------------

/**
 * Run the bounded agentic tool-loop.
 *
 * Extracted as a standalone function so tests can inject a fake client
 * without making real network calls.
 */
export async function runToolLoop(
  client: ClientLike,
  opts: Omit<OrchestratorTurnOpts, "apiKey" | "baseUrl">
): Promise<OrchestratorTurnResult> {
  const maxIterations = opts.maxIterations ?? 8;

  // Seed the working messages from the caller's ChatMessage array.
  // ChatMessage uses plain string content; we preserve that for the initial messages.
  const working: WorkingMessage[] = opts.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let reply = "";
  let currentModel = opts.model;

  for (let i = 0; i < maxIterations; i++) {
    // ------------------------------------------------------------------
    // 0. Check if the caller has aborted before making another model call.
    // ------------------------------------------------------------------
    if (opts.signal?.aborted) break;

    const isFirstIteration = i === 0;

    // ------------------------------------------------------------------
    // 1. Stream a turn
    // ------------------------------------------------------------------
    let final: Awaited<ReturnType<StreamLike["finalMessage"]>>;

    const doStream = async (model: string) => {
      const stream = client.messages.stream({
        model,
        system: opts.systemPrompt,
        tools: ORCHESTRATOR_TOOLS,
        messages: working,
        max_tokens: 4096,
        ...(opts.signal ? { signal: opts.signal } : {}),
      });

      stream.on("text", (delta: string) => {
        reply += delta;
        opts.onText(delta);
      });

      return stream.finalMessage();
    };

    const isAbortError = (e: unknown): boolean =>
      (e as { name?: string })?.name === "AbortError" || !!opts.signal?.aborted;

    try {
      final = await doStream(currentModel);
    } catch (e) {
      if (isAbortError(e)) {
        // Caller cancelled — return whatever we've accumulated so far, cleanly.
        break;
      }
      if (isFirstIteration && isModelError(e) && currentModel !== fallbackModel(currentModel)) {
        try {
          currentModel = fallbackModel(currentModel);
          final = await doStream(currentModel);
        } catch (e2) {
          if (isAbortError(e2)) break;
          throw e2;
        }
      } else {
        throw e;
      }
    }

    // ------------------------------------------------------------------
    // 2. Collect tool_use blocks
    // ------------------------------------------------------------------
    const toolUseBlocks = final.content.filter(
      (b): b is Required<ContentBlock> & { type: "tool_use" } => b.type === "tool_use"
    );

    if (toolUseBlocks.length === 0) {
      // No tool calls — the model is done.
      break;
    }

    // ------------------------------------------------------------------
    // 3. Append assistant message + run tools
    // ------------------------------------------------------------------
    const assistantContent: WorkingContent[] = final.content.map((b) => {
      if (b.type === "text") {
        return { type: "text", text: b.text ?? "" };
      }
      // tool_use block — keep id/name/input
      return {
        type: "tool_use",
        id: b.id ?? "",
        name: b.name ?? "",
        input: b.input,
      };
    });

    working.push({ role: "assistant", content: assistantContent });

    const toolResults: ToolResultContentBlock[] = [];

    for (const block of toolUseBlocks) {
      const name = block.name;
      const input = block.input;

      opts.onToolEvent?.({ name, input, phase: "start" });

      const outcome = await opts.onToolCall(name, input);

      opts.onToolEvent?.({ name, input, phase: "done", ok: outcome.ok, message: outcome.message });

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: outcome.message,
        is_error: !outcome.ok,
      });
    }

    // ------------------------------------------------------------------
    // 4. Append tool results and loop
    // ------------------------------------------------------------------
    working.push({ role: "user", content: toolResults });
  }

  return { reply };
}

// ---------------------------------------------------------------------------
// Public entry-point
// ---------------------------------------------------------------------------

/**
 * Run one conversational turn of the Orchestrator v2 controller.
 *
 * The model may call ORCHESTRATOR_TOOLS repeatedly; each result is fed back
 * and the loop continues until the model stops calling tools OR until
 * `maxIterations` is reached (default 8).
 */
export async function orchestratorTurn(
  opts: OrchestratorTurnOpts
): Promise<OrchestratorTurnResult> {
  const client = makeAnthropic(opts.apiKey, opts.baseUrl);
  return runToolLoop(client as unknown as ClientLike, opts);
}
