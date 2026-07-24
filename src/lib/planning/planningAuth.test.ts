import { describe, it, expect } from "vitest";
import { resolvePlanningAuth } from "./planningAuth";

const secrets = (m: Record<string, string>) => async (k: string) => m[k] ?? null;

describe("resolvePlanningAuth", () => {
  it("anthropic key → ready, no baseUrl", async () => {
    const a = await resolvePlanningAuth("claude", false, secrets({ anthropic_api_key: "sk-ant" }));
    expect(a).toMatchObject({ apiKey: "sk-ant", ready: true });
    expect(a.baseUrl).toBeUndefined();
  });
  it("kimi key → ready with moonshot baseUrl", async () => {
    const a = await resolvePlanningAuth("kimi", false, secrets({ moonshot_api_key: "sk-m" }));
    expect(a).toMatchObject({ apiKey: "sk-m", baseUrl: "https://api.moonshot.ai/anthropic", ready: true });
  });
  it("missing key → not ready with a reason", async () => {
    const a = await resolvePlanningAuth("deepseek", false, secrets({}));
    expect(a.ready).toBe(false);
    expect(a.reason).toBeTruthy();
  });
  it("claude + login (no key) → not ready, explains Phase-2 gap", async () => {
    const a = await resolvePlanningAuth("claude", true, secrets({}));
    expect(a.ready).toBe(false);
    expect(a.reason).toMatch(/login/i);
  });
  it("claude + login WITH an anthropic key → ready", async () => {
    const a = await resolvePlanningAuth("claude", true, secrets({ anthropic_api_key: "sk-ant-with-login" }));
    expect(a).toMatchObject({ apiKey: "sk-ant-with-login", ready: true });
    expect(a.baseUrl).toBeUndefined();
  });
});
