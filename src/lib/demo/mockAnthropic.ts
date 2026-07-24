/**
 * mockAnthropic.ts — A fake Anthropic client returned by makeAnthropic() in
 * demo mode. Implements the exact stream/message surface that planningChat.ts,
 * review.ts, and orchestratorTurn.ts consume:
 *
 *   messages.stream(params)
 *     → fake MessageStream with .on("text"|..., cb) + .finalMessage(): Promise<Message>
 *
 *   messages.create(params)
 *     → Promise<Message> with content blocks in the same shape
 *
 * The mock inspects params.tools to pick a canned response. All replies are
 * SHORT and DETERMINISTIC — the goal is a coherent flow, not realism.
 */

import {
  DEMO_PRD,
  DEMO_ARCHITECTURE,
  DEMO_UX,
  DEMO_DOCS,
  DEMO_OPS,
  DEMO_BACKLOG,
  DEMO_STORY,
} from "./demoContent";

// ---------------------------------------------------------------------------
// Minimal internal shapes that mirror what the real SDK returns.
// ---------------------------------------------------------------------------

/** A content block in a Message response (text or tool_use). */
type ContentBlock =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: unknown;
    };

/** Shape of the Message object the consumers read. */
interface MockMessage {
  content: ContentBlock[];
  stop_reason: "end_turn" | "tool_use";
  usage: { input_tokens: number; output_tokens: number };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toolUseId(): string {
  return `tu_demo_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Inspect the tools list to detect which persona turn this is.
 * Returns the first tool name found in the list.
 */
function detectTurn(params: {
  tools?: unknown[];
  tool_choice?: unknown;
}): string | null {
  const tools = params.tools ?? [];
  for (const t of tools) {
    const name = (t as { name?: string }).name;
    if (name) return name;
  }
  // tool_choice may pin a specific tool
  const tc = params.tool_choice as { name?: string } | undefined;
  if (tc?.name) return tc.name;
  return null;
}

/**
 * Given the first tool name, build the canned response content blocks.
 * Inspects system prompt for persona-specific routing.
 */
function buildContent(
  firstTool: string | null,
  systemPrompt: string
): ContentBlock[] {
  // --- write_document: route by persona (system prompt keyword) ---
  if (firstTool === "write_document") {
    const sys = systemPrompt.toLowerCase();
    let markdown: string;
    let persona: string;

    if (sys.includes("architect") || sys.includes("architecture")) {
      markdown = DEMO_ARCHITECTURE;
      persona = "the Architect";
    } else if (sys.includes("designer") || sys.includes("ux/ui")) {
      markdown = DEMO_UX;
      persona = "the Designer";
    } else if (sys.includes("technical writer")) {
      markdown = DEMO_DOCS;
      persona = "the Technical Writer";
    } else if (sys.includes("devops") || sys.includes("release engineer")) {
      markdown = DEMO_OPS;
      persona = "the DevOps Engineer";
    } else {
      // PM / Analyst / default
      markdown = DEMO_PRD;
      persona = "the PM";
    }

    return [
      {
        type: "text",
        text: `Here is the document from ${persona}.`,
      },
      {
        type: "tool_use",
        id: toolUseId(),
        name: "write_document",
        input: { markdown },
      },
    ];
  }

  // --- write_mockup: UX Designer mockup ---
  if (firstTool === "write_mockup") {
    return [
      { type: "text", text: "Here is the UX mockup." },
      {
        type: "tool_use",
        id: toolUseId(),
        name: "write_mockup",
        input: {
          html: `<!DOCTYPE html><html><head><style>body{font-family:sans-serif;padding:2rem;background:#f5f5f5}h1{color:#1a1a2e}</style></head><body><h1>Demo App</h1><p>Main screen mockup.</p></body></html>`,
        },
      },
    ];
  }

  // --- suggest_verification: Architect verification command ---
  if (firstTool === "suggest_verification") {
    return [
      { type: "text", text: "I suggest the following verification command." },
      {
        type: "tool_use",
        id: toolUseId(),
        name: "suggest_verification",
        input: { command: "npm test" },
      },
    ];
  }

  // --- handoff: PM handing to the next specialist ---
  if (firstTool === "handoff") {
    return [
      {
        type: "text",
        text: "The PRD looks solid. Bringing in the Architect.",
      },
      {
        type: "tool_use",
        id: toolUseId(),
        name: "handoff",
        input: { role: "architect", note: "Design the technical architecture." },
      },
    ];
  }

  // --- suggest_replies: quick-reply suggestions ---
  if (firstTool === "suggest_replies") {
    return [
      {
        type: "tool_use",
        id: toolUseId(),
        name: "suggest_replies",
        input: { replies: ["Looks good", "Make it simpler", "Add more detail"] },
      },
    ];
  }

  // --- create_story: SM sharding a single story ---
  if (firstTool === "create_story") {
    return [
      {
        type: "tool_use",
        id: toolUseId(),
        name: "create_story",
        input: DEMO_STORY,
      },
    ];
  }

  // --- create_backlog: SM sharding the full backlog ---
  if (firstTool === "create_backlog") {
    return [
      {
        type: "tool_use",
        id: toolUseId(),
        name: "create_backlog",
        input: { stories: DEMO_BACKLOG },
      },
    ];
  }

  // --- report_findings: adversarial review → always accept ---
  if (firstTool === "report_findings") {
    return [
      {
        type: "tool_use",
        id: toolUseId(),
        name: "report_findings",
        input: {
          verdict: "accept",
          summary: "No blocking issues found — artifact is ready.",
          findings: [],
        },
      },
    ];
  }

  // --- Orchestrator tools: shard/approve/dispatch — return text + stop ---
  if (
    firstTool === "shard_story" ||
    firstTool === "shard_backlog" ||
    firstTool === "approve_story" ||
    firstTool === "dispatch_story" ||
    firstTool === "dispatch_ready"
  ) {
    return [
      {
        type: "text",
        text: "Here is a quick overview of the demo project status. The backlog has 3 stories, all approved and ready to dispatch.",
      },
    ];
  }

  // --- Default: plain-text reply, no tool ---
  return [
    {
      type: "text",
      text: "Understood. Let me know how you'd like to proceed.",
    },
  ];
}

// ---------------------------------------------------------------------------
// Fake MessageStream — satisfies the surface planningChat + orchestratorTurn use
// ---------------------------------------------------------------------------

/**
 * A fake stream object that:
 *  - Accepts .on("text", cb) / .on(event, cb) registrations
 *  - Emits text deltas asynchronously (next-tick) for any "text" content block
 *  - Resolves .finalMessage() with a properly shaped MockMessage
 *
 * The orchestratorTurn.ts `StreamLike` interface requires exactly:
 *   stream.on(event, cb): StreamLike
 *   stream.finalMessage(): Promise<{content, stop_reason, usage}>
 *
 * planningChat.ts additionally calls stream.on("text", delta => ...) to get
 * streaming text before awaiting finalMessage().
 */
class FakeMessageStream {
  private _textListeners: Array<(delta: string) => void> = [];
  private _message: MockMessage;

  constructor(content: ContentBlock[]) {
    const hasToolUse = content.some((b) => b.type === "tool_use");
    this._message = {
      content,
      stop_reason: hasToolUse ? "tool_use" : "end_turn",
      usage: { input_tokens: 50, output_tokens: 80 },
    };

    // Schedule text emission on next tick so .on() registrations that happen
    // synchronously after stream() returns all receive the events.
    const textBlocks = content.filter(
      (b): b is { type: "text"; text: string } => b.type === "text"
    );
    if (textBlocks.length > 0) {
      Promise.resolve().then(() => {
        for (const block of textBlocks) {
          for (const listener of this._textListeners) {
            listener(block.text);
          }
        }
      });
    }
  }

  /** Register an event listener. Returns `this` for chaining. */
  on(event: string, cb: (delta: string) => void): this {
    if (event === "text") {
      this._textListeners.push(cb);
    }
    // Other events (contentBlock, message, etc.) are not consumed by the real
    // code paths we mock, so we silently ignore them.
    return this;
  }

  /** Resolves with the final Message after all events have been emitted. */
  async finalMessage(): Promise<MockMessage> {
    // Yield to the microtask queue so any .on("text") listeners registered
    // synchronously after stream() returns can fire first.
    await Promise.resolve();
    return this._message;
  }
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/** The loose internal params shape the mock stream accepts. */
export interface MockStreamParams {
  model?: string;
  system?: string;
  tools?: unknown[];
  tool_choice?: unknown;
  messages?: unknown[];
  max_tokens?: number;
  signal?: AbortSignal;
}

/** The loose internal params shape the mock create accepts. */
export interface MockCreateParams {
  model?: string;
  system?: string;
  tools?: unknown[];
  tool_choice?: unknown;
  messages?: unknown[];
  max_tokens?: number;
}

/** Internal mock messages object — typed loosely so tests can call it directly. */
export interface MockMessagesApi {
  stream(params: MockStreamParams): FakeMessageStream;
  create(params: MockCreateParams): Promise<MockMessage>;
}

/** Build the internal mock messages object. */
function buildMockMessages(): MockMessagesApi {
  return {
    /**
     * Returns a fake stream that emits text events then resolves finalMessage().
     * Matches the surface consumed by planningChat.planningTurn and
     * orchestratorTurn.runToolLoop.
     */
    stream(params: MockStreamParams): FakeMessageStream {
      const firstTool = detectTurn(params);
      const content = buildContent(firstTool, params.system ?? "");
      return new FakeMessageStream(content);
    },

    /**
     * Returns a resolved Promise<Message>.
     * Matches the surface consumed by planningChat.callTool and
     * review.reviewArtifact (both use messages.create with tool_choice).
     */
    async create(params: MockCreateParams): Promise<MockMessage> {
      const firstTool = detectTurn(params);
      const content = buildContent(firstTool, params.system ?? "");
      const hasToolUse = content.some((b) => b.type === "tool_use");
      return {
        content,
        stop_reason: hasToolUse ? "tool_use" : "end_turn",
        usage: { input_tokens: 50, output_tokens: 80 },
      };
    },
  };
}

/**
 * Returns a mock Anthropic-shaped client for demo mode.
 *
 * Cast via `as unknown as Anthropic` at the call site (planningChat.ts).
 * Only the `messages` property is needed by the real consumers.
 *
 * The returned object's `messages` property is typed as `MockMessagesApi`
 * for tests; the cast to `Anthropic` happens in planningChat.ts.
 */
export function makeMockAnthropic(): { messages: MockMessagesApi } {
  return { messages: buildMockMessages() };
}
