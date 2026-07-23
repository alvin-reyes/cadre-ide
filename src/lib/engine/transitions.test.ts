import { describe, it, expect } from "vitest";
import { canTransition, assertTransition } from "./transitions";

describe("canTransition", () => {
  it("allows the happy-path edges", () => {
    expect(canTransition("Draft", "Approved")).toBe(true);
    expect(canTransition("Approved", "InProgress")).toBe(true);
    expect(canTransition("InProgress", "InReview")).toBe(true);
    expect(canTransition("InReview", "Done")).toBe(true);
  });

  it("allows Done → Blocked when a verified story can't merge back", () => {
    expect(canTransition("Done", "Blocked")).toBe(true);
  });

  it("allows a same-status no-op (resume re-dispatches an InProgress story)", () => {
    expect(canTransition("InProgress", "InProgress")).toBe(true);
    expect(canTransition("Done", "Done")).toBe(true);
  });

  it("forbids skipping the discipline (Draft cannot jump to Done)", () => {
    expect(canTransition("Draft", "Done")).toBe(false);
    expect(canTransition("Approved", "Done")).toBe(false);
    expect(canTransition("InProgress", "Done")).toBe(false);
  });

  it("lets a failed story bounce back to InProgress", () => {
    expect(canTransition("InReview", "Failed")).toBe(true);
    expect(canTransition("Failed", "InProgress")).toBe(true);
  });

  it("makes re-open the only forward path out of Done (human-gated)", () => {
    expect(canTransition("Done", "Approved")).toBe(true);
    expect(canTransition("Done", "InProgress")).toBe(false); // can't jump back into work
    // Done → Done is a no-op (allowed), not a forward move — see the same-status test.
  });

  it("allows blocking from any active state and resuming", () => {
    expect(canTransition("InProgress", "Blocked")).toBe(true);
    expect(canTransition("Blocked", "InProgress")).toBe(true);
  });
});

describe("assertTransition", () => {
  it("throws on an illegal transition", () => {
    expect(() => assertTransition("Draft", "Done")).toThrow(/illegal/);
  });

  it("does not throw on a legal transition", () => {
    expect(() => assertTransition("InReview", "Done")).not.toThrow();
  });
});
