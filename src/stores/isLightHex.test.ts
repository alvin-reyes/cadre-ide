import { describe, it, expect } from "vitest";
import { isLightHex } from "./settingsStore";

describe("isLightHex (theme lightness)", () => {
  it("treats dark preset backgrounds as not light", () => {
    expect(isLightHex("#0c1512")).toBe(false); // mint bgPrimary
    expect(isLightHex("#000000")).toBe(false);
    expect(isLightHex("#0b0b12")).toBe(false);
  });

  it("treats light backgrounds as light", () => {
    expect(isLightHex("#f5f5f7")).toBe(true);
    expect(isLightHex("#ffffff")).toBe(true);
    expect(isLightHex("#eee")).toBe(true); // 3-digit
  });

  it("fails safe to dark on malformed input", () => {
    expect(isLightHex("not-a-color")).toBe(false);
  });
});
