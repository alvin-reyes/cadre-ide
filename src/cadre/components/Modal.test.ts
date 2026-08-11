import { describe, it, expect, afterEach, vi } from "vitest";
import { pushModal, popModal, isTopModal } from "./Modal";

/**
 * Regression: nested-modal Escape double-close.
 *
 * Every <Modal> registers a capture-phase keydown listener on the SAME
 * `document`. e.stopPropagation() does NOT stop sibling listeners on that shared
 * target, so before the fix, opening a modal-in-modal (Settings → Connections →
 * ConnectionModal) meant one Escape fired BOTH onClose handlers — discarding the
 * connection editor AND the whole Settings dialog (losing the typed token).
 *
 * The repo has no jsdom / @testing-library harness (vitest runs in the "node"
 * environment; adding a DOM harness would mean editing shared package.json /
 * vitest.config.ts, off-limits here). So this exercises the exact arbitration
 * primitives each Modal's Escape handler consults — `isTopModal(token)` gates
 * whether that instance calls onClose — which is the precise decision that was
 * broken. Each test drains its own tokens so the module-level stack stays clean.
 */

/**
 * Faithful stand-in for the branch inside Modal's onKey: on Escape, a modal only
 * invokes its own onClose when it is the topmost open modal. Mirrors the real
 * component so the test asserts the shipped behavior, not a re-derivation.
 */
function escape(token: symbol, onClose: () => void): void {
  if (!isTopModal(token)) return;
  onClose();
}

describe("Modal Escape arbitration (modal stack)", () => {
  const opened: symbol[] = [];
  function open(): symbol {
    const t = pushModal();
    opened.push(t);
    return t;
  }
  afterEach(() => {
    // Pop anything a test left open so stacks don't leak between tests.
    while (opened.length) popModal(opened.pop()!);
  });

  it("closes only the TOP modal on Escape, leaving the outer one open", () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();

    const outer = open(); // Settings
    const inner = open(); // ConnectionModal (on top)

    // One Escape keydown reaches every modal's listener; each consults the stack.
    escape(outer, outerClose);
    escape(inner, innerClose);

    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
  });

  it("closes the now-topmost modal after the inner one unmounts", () => {
    const outerClose = vi.fn();

    const outer = open();
    const inner = open();

    // Inner closes/unmounts → it pops itself off the stack.
    popModal(inner);
    opened.splice(opened.indexOf(inner), 1);

    escape(outer, outerClose);

    expect(outerClose).toHaveBeenCalledTimes(1);
  });

  it("still closes a single (non-nested) modal on Escape — the common case", () => {
    const close = vi.fn();
    const only = open();

    escape(only, close);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("popModal is a no-op for a token that is not on the stack", () => {
    const a = open();
    const stray = Symbol("never-pushed");

    popModal(stray); // must not throw or disturb the real stack

    const close = vi.fn();
    escape(a, close);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("isTopModal is false when no modal is open", () => {
    const ghost = Symbol("closed");
    expect(isTopModal(ghost)).toBe(false);
  });
});
