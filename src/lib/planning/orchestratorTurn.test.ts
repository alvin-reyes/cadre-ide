import { describe, it, expect, vi } from "vitest";
import { runToolLoop, type ContentBlock } from "./orchestratorTurn";

// ---------------------------------------------------------------------------
// Fake client helpers
// ---------------------------------------------------------------------------

/** A minimal stream object that calls onText once then returns a finalMessage. */
function fakeStream(text: string, content: ContentBlock[]) {
  return {
    on(event: string, cb: (delta: string) => void) {
      if (event === "text" && text) cb(text);
      return this; // chainable
    },
    finalMessage: async () => ({
      content,
      stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
      usage: { input_tokens: 10, output_tokens: 10 },
    }),
  };
}

/** Build a fake client that plays back a scripted sequence of responses. */
function makeFakeClient(responses: Array<{ text: string; content: ContentBlock[] }>) {
  let callIndex = 0;
  const streamCalls: unknown[][] = []; // capture messages sent on each call

  const client = {
    _streamCalls: streamCalls,
    messages: {
      stream(params: { messages: unknown[] }) {
        streamCalls.push(params.messages);
        const resp = responses[callIndex] ?? responses[responses.length - 1]; // repeat last
        callIndex++;
        return fakeStream(resp.text, resp.content);
      },
    },
  };
  return client;
}

// ---------------------------------------------------------------------------
// Shared opts factory
// ---------------------------------------------------------------------------

function baseOpts(overrides: Partial<Parameters<typeof runToolLoop>[1]> = {}) {
  return {
    model: "claude-sonnet-4-5",
    systemPrompt: "You are the orchestrator.",
    messages: [{ role: "user" as const, content: "Start" }],
    onText: vi.fn(),
    onToolCall: vi.fn().mockResolvedValue({ ok: true, message: "done" }),
    onToolEvent: vi.fn(),
    maxIterations: 8,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runToolLoop", () => {
  it("runs a tool then finishes, feeding the result back", async () => {
    // First stream: model calls dispatch_story
    // Second stream: model replies with text only → loop ends
    const toolUseBlock = {
      type: "tool_use",
      id: "tu_abc123",
      name: "dispatch_story",
      input: { epic: 1, story: 2 },
    };
    const textBlock = { type: "text", text: "All done!" };

    const client = makeFakeClient([
      { text: "", content: [toolUseBlock] },
      { text: "All done!", content: [textBlock] },
    ]);

    const opts = baseOpts();
    const result = await runToolLoop(client, opts);

    // onToolCall was invoked with the right tool name + input
    expect(opts.onToolCall).toHaveBeenCalledTimes(1);
    expect(opts.onToolCall).toHaveBeenCalledWith("dispatch_story", { epic: 1, story: 2 });

    // onToolEvent fired start then done
    expect(opts.onToolEvent).toHaveBeenCalledTimes(2);
    expect(opts.onToolEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ name: "dispatch_story", phase: "start" })
    );
    expect(opts.onToolEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ name: "dispatch_story", phase: "done", ok: true, message: "done" })
    );

    // Only 2 stream calls: one for the tool_use turn, one for the text-only turn
    expect(client._streamCalls).toHaveLength(2);

    // On the second stream call the messages include a tool_result
    const secondCallMessages = client._streamCalls[1] as Array<{
      role: string;
      content: unknown;
    }>;
    const userTurn = secondCallMessages.find((m) => m.role === "user" && Array.isArray(m.content));
    expect(userTurn).toBeDefined();
    const toolResultBlock = (userTurn!.content as object[]).find(
      (b) => (b as { type: string }).type === "tool_result"
    );
    expect(toolResultBlock).toMatchObject({
      type: "tool_result",
      tool_use_id: "tu_abc123",
      content: "done",
      is_error: false,
    });

    // reply contains the accumulated text (from the second turn)
    expect(result.reply).toContain("All done!");
  });

  it("caps at maxIterations when the model never stops calling tools", async () => {
    // Every stream response is another tool_use — the loop must cap at maxIterations
    const toolUseBlock = {
      type: "tool_use",
      id: "tu_inf",
      name: "dispatch_story",
      input: { epic: 1, story: 1 },
    };

    const client = makeFakeClient([
      { text: "", content: [toolUseBlock] }, // repeated forever via the "repeat last" fallback
    ]);

    const MAX = 5;
    const opts = baseOpts({ maxIterations: MAX });
    const result = await runToolLoop(client, opts);

    // Exactly maxIterations stream calls — no more
    expect(client._streamCalls).toHaveLength(MAX);
    // onToolCall fired once per iteration (MAX times)
    expect(opts.onToolCall).toHaveBeenCalledTimes(MAX);
    // Returns without hanging
    expect(result).toHaveProperty("reply");
  });

  it("accumulates text across multiple turns", async () => {
    const toolUseBlock = {
      type: "tool_use",
      id: "tu_x1",
      name: "dispatch_story",
      input: { epic: 2, story: 3 },
    };

    const client = makeFakeClient([
      { text: "Thinking... ", content: [toolUseBlock] },
      { text: "Done!", content: [{ type: "text", text: "Done!" }] },
    ]);

    const opts = baseOpts();
    const result = await runToolLoop(client, opts);

    // Both text chunks should be in the reply
    expect(result.reply).toContain("Thinking");
    expect(result.reply).toContain("Done!");
  });

  it("breaks immediately when first response has no tool_use", async () => {
    const client = makeFakeClient([
      { text: "Hello!", content: [{ type: "text", text: "Hello!" }] },
    ]);

    const opts = baseOpts();
    await runToolLoop(client, opts);

    expect(client._streamCalls).toHaveLength(1);
    expect(opts.onToolCall).not.toHaveBeenCalled();
  });
});
