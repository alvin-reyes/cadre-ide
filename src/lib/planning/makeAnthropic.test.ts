import { describe, it, expect } from "vitest";
import { makeAnthropic } from "./planningChat";

describe("makeAnthropic", () => {
  it("without baseUrl, uses the default Anthropic base URL", () => {
    const client = makeAnthropic("sk-test");
    // The Anthropic SDK defaults to https://api.anthropic.com
    expect(client.baseURL).toContain("anthropic.com");
    expect(client.baseURL).not.toContain("moonshot");
  });

  it("with baseUrl, sets the client baseURL to the given provider endpoint", () => {
    const client = makeAnthropic("sk-test", "https://api.moonshot.ai/anthropic");
    expect(client.baseURL).toContain("moonshot.ai");
  });

  it("baseUrl undefined → identical base URL to no-arg call", () => {
    const withUndefined = makeAnthropic("sk-test", undefined);
    const withoutArg = makeAnthropic("sk-test");
    expect(withUndefined.baseURL).toBe(withoutArg.baseURL);
  });

  it("baseUrl set to DeepSeek endpoint → baseURL reflects DeepSeek host", () => {
    const client = makeAnthropic("sk-ds", "https://api.deepseek.com/anthropic");
    expect(client.baseURL).toContain("deepseek.com");
  });
});
