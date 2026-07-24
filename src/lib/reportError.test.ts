/**
 * reportError.test.ts — TDD for the error-surfacing helper.
 *
 * errorMessage() extracts a human-readable string from any thrown value.
 * reportError() fires a toast (error kind) AND pushes an error-level entry
 * to the AI Log in a single call, so no catch site ever swallows a failure.
 *
 * The zustand stores are real (no mocking needed) — we reset their state
 * between tests with setState to keep the suite hermetic.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useAiLog } from "../stores/aiLogStore";
import { useToastStore } from "../stores/toastStore";
import { errorMessage, reportError } from "./reportError";

// Reset both stores before each test so assertions are not polluted by
// entries from prior tests.
beforeEach(() => {
  useAiLog.setState({ entries: [] });
  useToastStore.setState({ toasts: [] });
});

// ---------------------------------------------------------------------------
// errorMessage
// ---------------------------------------------------------------------------
describe("errorMessage", () => {
  it("returns the message from an Error instance", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns a string directly", () => {
    expect(errorMessage("plain string error")).toBe("plain string error");
  });

  it("JSON-serialises an arbitrary object", () => {
    const result = errorMessage({ code: 42, reason: "oops" });
    expect(result).toBe(JSON.stringify({ code: 42, reason: "oops" }));
  });
});

// ---------------------------------------------------------------------------
// reportError
// ---------------------------------------------------------------------------
describe("reportError", () => {
  it("pushes an error-level AI Log entry with correct source and text", () => {
    reportError("dispatch 1.2", new Error("timeout"));

    const { entries } = useAiLog.getState();
    const last = entries[entries.length - 1];
    expect(last).toBeDefined();
    expect(last.level).toBe("error");
    expect(last.source).toBe("dispatch 1.2");
    expect(last.text).toBe("timeout");
  });

  it("pushes an error-kind toast with the error message by default", () => {
    reportError("planning", "something went wrong");

    const { toasts } = useToastStore.getState();
    const last = toasts[toasts.length - 1];
    expect(last).toBeDefined();
    expect(last.kind).toBe("error");
    expect(last.message).toBe("something went wrong");
  });

  it("uses toastMessage override for the toast when provided", () => {
    reportError("approve", new Error("internal detail"), { toastMessage: "Approval failed" });

    const { toasts } = useToastStore.getState();
    const last = toasts[toasts.length - 1];
    expect(last.message).toBe("Approval failed");
    expect(last.kind).toBe("error");

    // The AI Log still records the raw error text, not the toast override.
    const { entries } = useAiLog.getState();
    const lastEntry = entries[entries.length - 1];
    expect(lastEntry.text).toBe("internal detail");
  });

  it("returns the extracted error message string", () => {
    const result = reportError("verify", new Error("bad exit code"));
    expect(result).toBe("bad exit code");
  });
});
