import { describe, it, expect } from "vitest";
import { findBalancedJsonObjects, lastJsonObject } from "./jsonScan";

describe("jsonScan", () => {
  it("finds top-level objects, string-aware (braces in strings don't desync)", () => {
    const objs = findBalancedJsonObjects('a {"x":"}{"} b {"y":1}');
    expect(objs).toEqual(['{"x":"}{"}', '{"y":1}']);
  });
  it("handles nested objects as one top-level span", () => {
    expect(findBalancedJsonObjects('{"a":{"b":{"c":1}}}')).toEqual(['{"a":{"b":{"c":1}}}']);
  });
  it("lastJsonObject returns the last qualifying object", () => {
    expect(lastJsonObject('{"taskId":"A"} then {"taskId":"B"}', (v: any) => !!v?.taskId))
      .toEqual({ taskId: "B" });
    expect(lastJsonObject('{"nope":1}', (v: any) => !!v?.taskId)).toBeNull();
    expect(lastJsonObject("no json")).toBeNull();
  });
});
