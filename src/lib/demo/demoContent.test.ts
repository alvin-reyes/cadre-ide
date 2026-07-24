/**
 * demoContent.test.ts — Unit tests for buildTranscript and streamTranscript.
 *
 * All timer-based tests use an injected synchronous scheduler so there are no
 * real timers and the suite is fully deterministic.
 */

import { describe, it, expect } from "vitest";
import { buildTranscript, streamTranscript } from "./demoContent";
import type { PtyEvent } from "./demoContent";

// ─── Synchronous fake scheduler ───────────────────────────────────────────────
// Collects scheduled callbacks in insertion order and runs them all immediately
// when `flush()` is called. Suitable for deterministic tests without real timers.

function makeFakeScheduler() {
  const queue: Array<() => void> = [];

  function schedule(fn: () => void, _ms: number): unknown {
    const idx = queue.length;
    queue.push(fn);
    return idx; // return a handle (index) — clearTimeout uses it
  }

  function flush() {
    // Run each callback once in order (simulates time passing).
    for (const fn of queue) {
      fn();
    }
  }

  function clear(handle: unknown) {
    const idx = handle as number;
    if (idx >= 0 && idx < queue.length) {
      queue[idx] = () => {}; // replace with no-op
    }
  }

  return { schedule, flush, clear };
}

// ─── buildTranscript ─────────────────────────────────────────────────────────

describe("buildTranscript", () => {
  it("returns a non-empty array", () => {
    const lines = buildTranscript();
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
  });

  it("length is within the 6–12 line bound", () => {
    const lines = buildTranscript();
    expect(lines.length).toBeGreaterThanOrEqual(6);
    expect(lines.length).toBeLessThanOrEqual(12);
  });

  it("every element is a non-empty string", () => {
    const lines = buildTranscript("My Feature");
    for (const line of lines) {
      expect(typeof line).toBe("string");
      expect(line.length).toBeGreaterThan(0);
    }
  });

  it("interpolates the story label when provided", () => {
    const lines = buildTranscript("Dark Mode Toggle");
    const joined = lines.join("\n");
    expect(joined).toContain("Dark Mode Toggle");
  });

  it("works without a label (no interpolation error)", () => {
    expect(() => buildTranscript()).not.toThrow();
    expect(() => buildTranscript(undefined)).not.toThrow();
  });
});

// ─── streamTranscript ─────────────────────────────────────────────────────────

describe("streamTranscript", () => {
  const textDecoder = new TextDecoder();

  function decodeData(data: number[]): string {
    return textDecoder.decode(new Uint8Array(data));
  }

  it("emits one output event per line then one exit {code:0}", () => {
    const lines = ["Line one", "Line two", "Line three"];
    const events: PtyEvent[] = [];
    const { schedule, flush } = makeFakeScheduler();

    streamTranscript((e) => events.push(e), lines, { tick: 10, schedule });
    flush();

    // Should have N output events + 1 exit event
    expect(events).toHaveLength(lines.length + 1);

    const outputEvents = events.filter((e) => e.type === "output");
    expect(outputEvents).toHaveLength(lines.length);

    const exitEvents = events.filter((e) => e.type === "exit");
    expect(exitEvents).toHaveLength(1);
    expect(exitEvents[0]).toEqual({ type: "exit", code: 0 });
  });

  it("output data is number[] of UTF-8 bytes that decode back to line + CRLF", () => {
    const lines = ["Hello, world!", "Second line"];
    const events: PtyEvent[] = [];
    const { schedule, flush } = makeFakeScheduler();

    streamTranscript((e) => events.push(e), lines, { tick: 10, schedule });
    flush();

    const outputEvents = events.filter((e) => e.type === "output") as Array<{
      type: "output";
      data: number[];
    }>;

    expect(outputEvents[0].data).toBeInstanceOf(Array);
    expect(decodeData(outputEvents[0].data)).toBe("Hello, world!\r\n");
    expect(decodeData(outputEvents[1].data)).toBe("Second line\r\n");
  });

  it("emits output events in the same order as the lines array", () => {
    const lines = ["alpha", "beta", "gamma"];
    const events: PtyEvent[] = [];
    const { schedule, flush } = makeFakeScheduler();

    streamTranscript((e) => events.push(e), lines, { tick: 10, schedule });
    flush();

    const outputEvents = events.filter((e) => e.type === "output") as Array<{
      type: "output";
      data: number[];
    }>;
    const decoded = outputEvents.map((e) => decodeData(e.data).replace("\r\n", ""));
    expect(decoded).toEqual(lines);
  });

  it("stop() cancels pending events and emits exit {code:143}", () => {
    const lines = ["line 1", "line 2", "line 3", "line 4"];
    const events: PtyEvent[] = [];

    const fakeScheduler = makeFakeScheduler();

    // Override clearTimeout to use fake clear
    const origClear = globalThis.clearTimeout;
    // We inject schedule + rely on the fake scheduler's clear; but streamTranscript
    // calls clearTimeout internally. Patch it for this test.
    const cleared = new Set<unknown>();
    globalThis.clearTimeout = (h: unknown) => {
      cleared.add(h);
      fakeScheduler.clear(h);
    };

    try {
      const { stop } = streamTranscript((e) => events.push(e), lines, {
        tick: 10,
        schedule: fakeScheduler.schedule,
      });

      // Stop before flushing (simulates kill before any output)
      stop();

      // Now flush — all callbacks should be no-ops because stop() cleared them
      fakeScheduler.flush();

      // Only the synthetic exit(143) from stop() should appear
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: "exit", code: 143 });
    } finally {
      globalThis.clearTimeout = origClear;
    }
  });

  it("stop() is a no-op after the stream has already exited", () => {
    const lines = ["only line"];
    const events: PtyEvent[] = [];
    const { schedule, flush } = makeFakeScheduler();

    const { stop } = streamTranscript((e) => events.push(e), lines, {
      tick: 10,
      schedule,
    });

    flush(); // stream completes, exit 0 emitted

    const countBefore = events.length;
    stop(); // should not emit another exit
    expect(events).toHaveLength(countBefore);
  });

  it("handles an empty lines array — emits just exit {code:0}", () => {
    const events: PtyEvent[] = [];
    const { schedule, flush } = makeFakeScheduler();

    streamTranscript((e) => events.push(e), [], { tick: 10, schedule });
    flush();

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "exit", code: 0 });
  });
});
