import { describe, it, expect } from "vitest";
import { materialize, serializeConfig } from "./materialize";
import type { Connection } from "./connections";

const clickup: Connection = {
  id: "clickup", presetId: "clickup", label: "ClickUp",
  transport: { kind: "stdio", command: "npx", args: ["-y", "pkg"], env: {} },
  secretRefs: [{ field: "CLICKUP_API_TOKEN", keychainKey: "mcp.clickup.token", target: "env" }],
  enabled: true, status: "connected",
};
const disabled: Connection = { ...clickup, id: "off", enabled: false };

describe("materialize", () => {
  it("emits placeholders, never secret values, and lists requiredSecrets", () => {
    const m = materialize([clickup, disabled]);
    expect(Object.keys(m.config.mcpServers)).toEqual(["clickup"]); // disabled excluded
    expect(m.config.mcpServers.clickup.env).toEqual({ CLICKUP_API_TOKEN: "${CLICKUP_API_TOKEN}" });
    expect(m.requiredSecrets).toEqual([{ envVar: "CLICKUP_API_TOKEN", keychainKey: "mcp.clickup.token" }]);
    const raw = serializeConfig(m);
    expect(raw).toContain("${CLICKUP_API_TOKEN}");
    expect(raw).not.toContain("mcp.clickup.token"); // keychain key doesn't leak into fleet file
  });

  it("http header secrets become ${VAR} placeholders too", () => {
    const sentry: Connection = {
      id: "sentry", presetId: "custom", label: "Sentry",
      transport: { kind: "http", url: "https://mcp.sentry.dev/mcp", headers: {} },
      secretRefs: [{ field: "Authorization", keychainKey: "mcp.sentry.auth", target: "header" }],
      enabled: true, status: "connected",
    };
    const m = materialize([sentry]);
    expect(m.config.mcpServers.sentry.headers).toEqual({ Authorization: "${Authorization}" });
  });
});
