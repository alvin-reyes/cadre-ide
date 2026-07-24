import { describe, it, expect } from "vitest";
import { parseModels } from "./models";

describe("parseModels", () => {
  it("returns {} when cadre.json has no models key", () => {
    expect(parseModels('{"name":"Acme","repos":[]}')).toEqual({});
  });

  it("returns {} for corrupt / non-JSON input", () => {
    expect(parseModels("{ not json")).toEqual({});
    expect(parseModels("")).toEqual({});
  });

  it("returns {} when models is not an object", () => {
    expect(parseModels('{"models":"nope"}')).toEqual({});
    expect(parseModels('{"models":42}')).toEqual({});
    expect(parseModels('{"models":null}')).toEqual({});
    expect(parseModels('{"models":["a"]}')).toEqual({});
  });

  it("keeps planning and fleet string values", () => {
    expect(
      parseModels('{"models":{"planning":"claude-opus-4-8","fleet":"kimi-k2"}}')
    ).toEqual({ planning: "claude-opus-4-8", fleet: "kimi-k2" });
  });

  it("drops empty-string and non-string planning/fleet", () => {
    expect(parseModels('{"models":{"planning":"","fleet":5}}')).toEqual({});
  });

  it("keeps a known provider id", () => {
    expect(parseModels('{"models":{"provider":"deepseek"}}')).toEqual({ provider: "deepseek" });
    expect(parseModels('{"models":{"provider":"claude"}}')).toEqual({ provider: "claude" });
    expect(parseModels('{"models":{"provider":"kimi"}}')).toEqual({ provider: "kimi" });
  });

  it("drops an unknown or malformed provider", () => {
    expect(parseModels('{"models":{"provider":"openai"}}')).toEqual({});
    expect(parseModels('{"models":{"provider":123}}')).toEqual({});
  });

  it("keeps valid fields and drops invalid ones together", () => {
    expect(
      parseModels('{"models":{"planning":"m1","fleet":"","provider":"bogus"}}')
    ).toEqual({ planning: "m1" });
  });
});
