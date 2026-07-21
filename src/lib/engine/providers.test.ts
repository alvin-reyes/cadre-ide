import { describe, it, expect } from "vitest";
import { PROVIDERS, getProvider, resolveAgentEnv } from "./providers";

describe("providers", () => {
  it("offers Claude, Kimi, and DeepSeek", () => {
    expect(Object.keys(PROVIDERS).sort()).toEqual(["claude", "deepseek", "kimi"]);
  });

  it("throws on an unknown provider", () => {
    expect(() => getProvider("gpt")).toThrow(/unknown provider/);
  });
});

describe("resolveAgentEnv", () => {
  it("uses ANTHROPIC_API_KEY for native Claude (no base URL)", () => {
    const { env, model } = resolveAgentEnv(getProvider("claude"), "sk-ant");
    expect(env).toEqual({ ANTHROPIC_API_KEY: "sk-ant" });
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(model).toBe("claude-sonnet-4-6");
  });

  it("uses BASE_URL + AUTH_TOKEN for Kimi (Anthropic-compatible endpoint)", () => {
    const { env, model } = resolveAgentEnv(getProvider("kimi"), "kimi-key");
    expect(env.ANTHROPIC_BASE_URL).toBe("https://api.moonshot.ai/anthropic");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("kimi-key");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(model).toBe("kimi-k2");
  });

  it("routes DeepSeek to its Anthropic-compatible endpoint", () => {
    const { env, model } = resolveAgentEnv(getProvider("deepseek"), "ds-key");
    expect(env.ANTHROPIC_BASE_URL).toBe("https://api.deepseek.com/anthropic");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("ds-key");
    expect(model).toBe("deepseek-v4-pro");
  });

  it("honors a model override", () => {
    const { model } = resolveAgentEnv(getProvider("kimi"), "k", "kimi-k2-thinking");
    expect(model).toBe("kimi-k2-thinking");
  });
});
