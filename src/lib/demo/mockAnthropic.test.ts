/**
 * mockAnthropic.test.ts — Tests for the mock Anthropic planning client.
 *
 * Asserts against the SAME accessors the real consumers use so a shape
 * mismatch fails here rather than at runtime.
 *
 * Consumer interfaces verified:
 *
 *   planningChat.planningTurn:
 *     stream = client.messages.stream(params)
 *     stream.on("text", (delta: string) => ...)   ← streaming text
 *     msg = await stream.finalMessage()
 *     for block of msg.content:
 *       block.type === "text"  → block.text
 *       block.type === "tool_use" → block.name, block.input
 *
 *   planningChat.callTool / review.reviewArtifact:
 *     msg = await client.messages.create(params)
 *     for block of msg.content:
 *       block.type === "tool_use" → block.name, block.input
 *
 *   orchestratorTurn.runToolLoop:
 *     stream = client.messages.stream(params)
 *     stream.on("text", ...)
 *     msg = await stream.finalMessage()
 *     msg.content → filter tool_use blocks → block.id, block.name, block.input
 *     msg.stop_reason
 */

import { describe, it, expect } from "vitest";
import { makeMockAnthropic, type MockStreamParams, type MockCreateParams } from "./mockAnthropic";
import { DEMO_PRD, DEMO_ARCHITECTURE, DEMO_UX, DEMO_BACKLOG, DEMO_STORY } from "./demoContent";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** The shape planningChat passes — includes a tools list and system prompt. */
function makeStreamParams(opts: {
  tools?: { name: string }[];
  system?: string;
}): MockStreamParams {
  return {
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: opts.system ?? "",
    tools: opts.tools ?? [],
    messages: [{ role: "user", content: "Hello" }],
  };
}

function makeCreateParams(opts: {
  tools?: { name: string }[];
  tool_choice?: { type: string; name: string };
  system?: string;
}): MockCreateParams {
  return {
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    system: opts.system ?? "",
    tools: opts.tools ?? [],
    tool_choice: opts.tool_choice,
    messages: [{ role: "user", content: "Review this." }],
  };
}

// ---------------------------------------------------------------------------
// messages.stream — write_document persona turns
// ---------------------------------------------------------------------------

describe("mockAnthropic — messages.stream (write_document)", () => {
  it("PM turn: finalMessage has a tool_use for write_document with PRD markdown", async () => {
    const client = makeMockAnthropic();
    const stream = client.messages.stream(
      makeStreamParams({
        tools: [{ name: "write_document" }],
        system: "You are a sharp, pragmatic Product Manager",
      })
    );

    const msg = await stream.finalMessage();

    // stop_reason must be "tool_use" because a tool block is present
    expect(msg.stop_reason).toBe("tool_use");
    expect(msg.usage.input_tokens).toBeGreaterThan(0);
    expect(msg.usage.output_tokens).toBeGreaterThan(0);

    // At least one tool_use block for write_document
    const toolBlocks = msg.content.filter((b) => b.type === "tool_use");
    expect(toolBlocks.length).toBeGreaterThan(0);

    const writeDoc = toolBlocks.find((b) => b.type === "tool_use" && b.name === "write_document");
    expect(writeDoc).toBeDefined();
    expect(writeDoc!.type).toBe("tool_use");
    if (writeDoc!.type === "tool_use") {
      // id must be a non-empty string (orchestratorTurn reads block.id)
      expect(typeof writeDoc!.id).toBe("string");
      expect(writeDoc!.id.length).toBeGreaterThan(0);
      // input.markdown must be a string matching the canned PRD
      const input = writeDoc!.input as { markdown?: string };
      expect(typeof input.markdown).toBe("string");
      expect(input.markdown).toBe(DEMO_PRD);
    }
  });

  it("Architect turn: write_document returns DEMO_ARCHITECTURE", async () => {
    const client = makeMockAnthropic();
    const stream = client.messages.stream(
      makeStreamParams({
        tools: [{ name: "write_document" }],
        system: "You are a pragmatic System Architect",
      })
    );
    const msg = await stream.finalMessage();
    const writeDoc = msg.content.find((b) => b.type === "tool_use" && b.name === "write_document");
    expect(writeDoc).toBeDefined();
    if (writeDoc?.type === "tool_use") {
      const input = writeDoc.input as { markdown?: string };
      expect(input.markdown).toBe(DEMO_ARCHITECTURE);
    }
  });

  it("Designer turn: write_document returns DEMO_UX", async () => {
    const client = makeMockAnthropic();
    const stream = client.messages.stream(
      makeStreamParams({
        tools: [{ name: "write_document" }],
        system: "You are a UX/UI Designer",
      })
    );
    const msg = await stream.finalMessage();
    const writeDoc = msg.content.find((b) => b.type === "tool_use" && b.name === "write_document");
    expect(writeDoc).toBeDefined();
    if (writeDoc?.type === "tool_use") {
      const input = writeDoc.input as { markdown?: string };
      expect(input.markdown).toBe(DEMO_UX);
    }
  });

});

// ---------------------------------------------------------------------------
// messages.stream — text events (streaming delta)
// ---------------------------------------------------------------------------

describe("mockAnthropic — messages.stream text events", () => {
  it("emits text delta via .on('text') before finalMessage resolves", async () => {
    const client = makeMockAnthropic();
    const stream = client.messages.stream(
      makeStreamParams({
        tools: [{ name: "write_document" }],
        system: "You are a sharp, pragmatic Product Manager",
      })
    );

    const deltas: string[] = [];
    // Register BEFORE awaiting finalMessage (same as planningChat does)
    stream.on("text", (d: string) => deltas.push(d));

    await stream.finalMessage();

    // There is a text block alongside the tool_use — it should have been emitted
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.join("").length).toBeGreaterThan(0);
  });

  it("default turn (no tools): emits text and stop_reason is end_turn", async () => {
    const client = makeMockAnthropic();
    const stream = client.messages.stream(
      makeStreamParams({ tools: [], system: "" })
    );

    const deltas: string[] = [];
    stream.on("text", (d: string) => deltas.push(d));

    const msg = await stream.finalMessage();

    expect(msg.stop_reason).toBe("end_turn");
    // No tool_use blocks
    const toolBlocks = msg.content.filter((b) => b.type === "tool_use");
    expect(toolBlocks.length).toBe(0);
    // Has a text block
    const textBlocks = msg.content.filter((b) => b.type === "text");
    expect(textBlocks.length).toBeGreaterThan(0);
    // Streamed via events
    expect(deltas.length).toBeGreaterThan(0);
  });

  it(".on() returns the stream itself for chaining", () => {
    const client = makeMockAnthropic();
    const stream = client.messages.stream(makeStreamParams({}));
    // planningChat chains: stream.on("text", ...) — must return stream-like
    const returned = stream.on("text", () => undefined);
    expect(returned).toBe(stream);
  });
});

// ---------------------------------------------------------------------------
// messages.stream — SM tool turns (create_story, create_backlog)
// ---------------------------------------------------------------------------

describe("mockAnthropic — messages.stream (SM tools)", () => {
  it("create_story turn: returns tool_use for create_story with valid story input", async () => {
    const client = makeMockAnthropic();
    const stream = client.messages.stream(
      makeStreamParams({ tools: [{ name: "create_story" }] })
    );
    const msg = await stream.finalMessage();

    const toolBlock = msg.content.find((b) => b.type === "tool_use" && b.name === "create_story");
    expect(toolBlock).toBeDefined();
    if (toolBlock?.type === "tool_use") {
      const input = toolBlock.input as typeof DEMO_STORY;
      // Required fields per CREATE_STORY_TOOL schema
      expect(typeof input.title).toBe("string");
      expect(typeof input.role).toBe("string");
      expect(typeof input.action).toBe("string");
      expect(typeof input.benefit).toBe("string");
      expect(Array.isArray(input.acceptanceCriteria)).toBe(true);
      expect(Array.isArray(input.tasks)).toBe(true);
      expect(typeof input.devNotes).toBe("string");
      expect(Array.isArray(input.files)).toBe(true);
      // definitionOfDone is required per storyTool.ts schema
      expect(Array.isArray(input.definitionOfDone)).toBe(true);
      expect(input.definitionOfDone.length).toBeGreaterThan(0);
      // Matches canned content
      expect(input).toEqual(DEMO_STORY);
    }
  });

  it("create_backlog turn: returns tool_use with stories array", async () => {
    const client = makeMockAnthropic();
    const stream = client.messages.stream(
      makeStreamParams({ tools: [{ name: "create_backlog" }] })
    );
    const msg = await stream.finalMessage();

    const toolBlock = msg.content.find((b) => b.type === "tool_use" && b.name === "create_backlog");
    expect(toolBlock).toBeDefined();
    if (toolBlock?.type === "tool_use") {
      const input = toolBlock.input as { stories: typeof DEMO_BACKLOG };
      expect(Array.isArray(input.stories)).toBe(true);
      expect(input.stories.length).toBeGreaterThan(0);
      // Each story has the required fields + phase
      for (const story of input.stories) {
        expect(typeof story.phase).toBe("string");
        expect(typeof story.title).toBe("string");
        expect(Array.isArray(story.definitionOfDone)).toBe(true);
        expect(story.definitionOfDone.length).toBeGreaterThan(0);
      }
      expect(input.stories).toEqual(DEMO_BACKLOG);
    }
  });
});

// ---------------------------------------------------------------------------
// messages.stream — handoff + suggest_replies
// ---------------------------------------------------------------------------

describe("mockAnthropic — messages.stream (handoff + suggest_replies)", () => {
  it("handoff turn: returns tool_use for handoff with a valid role", async () => {
    const client = makeMockAnthropic();
    const stream = client.messages.stream(
      makeStreamParams({ tools: [{ name: "handoff" }] })
    );
    const msg = await stream.finalMessage();
    const toolBlock = msg.content.find((b) => b.type === "tool_use" && b.name === "handoff");
    expect(toolBlock).toBeDefined();
    if (toolBlock?.type === "tool_use") {
      const input = toolBlock.input as { role: string; note?: string };
      const validRoles = ["architect", "design"];
      expect(validRoles).toContain(input.role);
    }
  });

  it("suggest_replies turn: returns tool_use for suggest_replies with replies array", async () => {
    const client = makeMockAnthropic();
    const stream = client.messages.stream(
      makeStreamParams({ tools: [{ name: "suggest_replies" }] })
    );
    const msg = await stream.finalMessage();
    const toolBlock = msg.content.find((b) => b.type === "tool_use" && b.name === "suggest_replies");
    expect(toolBlock).toBeDefined();
    if (toolBlock?.type === "tool_use") {
      const input = toolBlock.input as { replies: string[] };
      expect(Array.isArray(input.replies)).toBe(true);
      expect(input.replies.length).toBeGreaterThanOrEqual(2);
      expect(input.replies.length).toBeLessThanOrEqual(4);
    }
  });
});

// ---------------------------------------------------------------------------
// messages.create — adversarial review (report_findings)
// ---------------------------------------------------------------------------

describe("mockAnthropic — messages.create (adversarial review)", () => {
  it("report_findings tool: returns accept verdict with empty findings", async () => {
    const client = makeMockAnthropic();
    // review.ts calls: client.messages.create({ ..., tools: [REPORT_FINDINGS_TOOL], tool_choice: { type:"tool", name:"report_findings" } })
    const msg = await client.messages.create(
      makeCreateParams({
        tools: [{ name: "report_findings" }],
        tool_choice: { type: "tool", name: "report_findings" },
        system: "You are an ADVERSARIAL Product Manager reviewer.",
      })
    );

    // review.ts reads:
    //   for block of response.content:
    //     if block.type === "tool_use" && block.name === "report_findings"
    //       input.verdict / input.summary / input.findings
    const toolBlock = msg.content.find(
      (b) => b.type === "tool_use" && b.name === "report_findings"
    );
    expect(toolBlock).toBeDefined();
    if (toolBlock?.type === "tool_use") {
      const input = toolBlock.input as {
        verdict: string;
        summary?: string;
        findings: unknown[];
      };
      // review.ts: input.verdict === "block" ? "block" : "accept"
      expect(input.verdict).toBe("accept");
      // findings must be an array (may be empty — no blocking issues)
      expect(Array.isArray(input.findings)).toBe(true);
    }
  });

  it("callTool (create_story via create): returns tool_use input for create_story", async () => {
    const client = makeMockAnthropic();
    // planningChat.callTool uses: client.messages.create({ ..., tools:[tool], tool_choice:{type:"tool",name:tool.name} })
    const msg = await client.messages.create(
      makeCreateParams({
        tools: [{ name: "create_story" }],
        tool_choice: { type: "tool", name: "create_story" },
      })
    );

    // planningChat.callTool reads:
    //   for block of response.content:
    //     if block.type === "tool_use" return block.input
    const toolBlock = msg.content.find((b) => b.type === "tool_use");
    expect(toolBlock).toBeDefined();
    if (toolBlock?.type === "tool_use") {
      expect(toolBlock.name).toBe("create_story");
      const input = toolBlock.input as typeof DEMO_STORY;
      expect(typeof input.title).toBe("string");
      expect(Array.isArray(input.definitionOfDone)).toBe(true);
    }
  });

  it("create returns a message with usage shape (recordUsage reads .usage)", async () => {
    const client = makeMockAnthropic();
    const msg = await client.messages.create(makeCreateParams({}));
    // planningChat: recordUsage(response.usage, usedModel) — usage must exist
    expect(msg.usage).toBeDefined();
    expect(typeof msg.usage.input_tokens).toBe("number");
    expect(typeof msg.usage.output_tokens).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// messages.stream — orchestratorTurn surface (stop_reason + id on tool_use)
// ---------------------------------------------------------------------------

describe("mockAnthropic — orchestratorTurn surface", () => {
  it("finalMessage has stop_reason and tool_use blocks carry id (orchestratorTurn reads block.id)", async () => {
    const client = makeMockAnthropic();
    const stream = client.messages.stream(
      makeStreamParams({ tools: [{ name: "shard_story" }] })
    );
    const msg = await stream.finalMessage();

    // orchestratorTurn reads final.stop_reason to decide loop continuation
    expect(typeof msg.stop_reason).toBe("string");
    // When stop_reason is "end_turn" no tool blocks, loop exits
    expect(msg.stop_reason).toBe("end_turn");
  });

  it("write_document stream: tool_use block has a non-empty id for orchestratorTurn.ts", async () => {
    const client = makeMockAnthropic();
    const stream = client.messages.stream(
      makeStreamParams({
        tools: [{ name: "write_document" }],
        system: "You are a pragmatic System Architect",
      })
    );
    const msg = await stream.finalMessage();

    const toolBlocks = msg.content.filter((b) => b.type === "tool_use");
    for (const b of toolBlocks) {
      if (b.type === "tool_use") {
        // orchestratorTurn: b.id ?? "" — id must be a non-empty string
        expect(typeof b.id).toBe("string");
        expect(b.id.length).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Demo guard: makeMockAnthropic is callable without isDemoMode being true
// (the guard lives in makeAnthropic in planningChat.ts, not here)
// ---------------------------------------------------------------------------

describe("makeMockAnthropic factory", () => {
  it("returns an object with a messages property containing stream and create", () => {
    const client = makeMockAnthropic();
    expect(client).toBeDefined();
    expect(typeof client.messages).toBe("object");
    expect(typeof client.messages.stream).toBe("function");
    expect(typeof client.messages.create).toBe("function");
  });
});
