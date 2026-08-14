import { describe, it, expect } from "vitest";

import {
  parseFieldFlags,
  primaryRequiredField,
  collectSecrets,
  secretsByKeychainKey,
  buildCustomTransport,
  formatConnectionLine,
  parseConnectArgv,
  unknownFields,
} from "./connectCli";
import type { Preset } from "../../lib/mcp/catalog";
import type { Connection } from "../../lib/mcp/connections";

const SECRET_VALUE = "sk-super-secret-token-value-12345";

const clickupPreset: Preset = {
  id: "clickup",
  label: "ClickUp",
  blurb: "Tasks, lists, docs.",
  transport: { kind: "stdio", command: "npx", args: ["-y", "@taazkareem/clickup-mcp-server"], env: {} },
  secretFields: [
    { field: "CLICKUP_API_TOKEN", label: "API token", target: "env", required: true },
    { field: "CLICKUP_TEAM_ID", label: "Team ID (optional)", target: "env", required: false },
  ],
};

const customPreset: Preset = {
  id: "custom",
  label: "Custom",
  blurb: "Any MCP server (stdio or HTTP).",
  custom: true,
  transport: { kind: "stdio", command: "", args: [], env: {} },
  secretFields: [],
};

describe("parseFieldFlags", () => {
  it("splits K=V pairs into a map", () => {
    expect(parseFieldFlags(["K=V", "A=B=C"])).toEqual({ K: "V", A: "B=C" });
  });

  it("splits only on the FIRST = so values may contain =", () => {
    expect(parseFieldFlags(["TOKEN=abc=def=ghi"])).toEqual({ TOKEN: "abc=def=ghi" });
  });

  it("ignores entries with no =", () => {
    expect(parseFieldFlags(["NOEQUALS", "K=V"])).toEqual({ K: "V" });
  });

  it("returns {} for an empty list", () => {
    expect(parseFieldFlags([])).toEqual({});
  });
});

describe("primaryRequiredField", () => {
  it("returns the first required field", () => {
    expect(primaryRequiredField(clickupPreset)?.field).toBe("CLICKUP_API_TOKEN");
  });

  it("returns undefined when the preset has no required fields", () => {
    expect(primaryRequiredField(customPreset)).toBeUndefined();
  });
});

describe("collectSecrets", () => {
  it("maps --token to the primary required field", () => {
    const { secrets, missing } = collectSecrets(clickupPreset, { token: SECRET_VALUE, fields: {} });
    expect(secrets).toEqual({ CLICKUP_API_TOKEN: SECRET_VALUE });
    expect(missing).toEqual([]);
  });

  it("maps --field values by field name", () => {
    const { secrets, missing } = collectSecrets(clickupPreset, {
      fields: { CLICKUP_API_TOKEN: SECRET_VALUE, CLICKUP_TEAM_ID: "team-9" },
    });
    expect(secrets).toEqual({ CLICKUP_API_TOKEN: SECRET_VALUE, CLICKUP_TEAM_ID: "team-9" });
    expect(missing).toEqual([]);
  });

  it("prefers an explicit --field over --token for the same field", () => {
    const { secrets } = collectSecrets(clickupPreset, {
      token: "from-token",
      fields: { CLICKUP_API_TOKEN: "from-field" },
    });
    expect(secrets.CLICKUP_API_TOKEN).toBe("from-field");
  });

  it("falls back to envToken for the primary field when no token/field given", () => {
    const { secrets, missing } = collectSecrets(clickupPreset, { fields: {}, envToken: "from-env" });
    expect(secrets).toEqual({ CLICKUP_API_TOKEN: "from-env" });
    expect(missing).toEqual([]);
  });

  it("reports missing required fields with no value from any source", () => {
    const { missing } = collectSecrets(clickupPreset, { fields: {} });
    expect(missing).toEqual(["CLICKUP_API_TOKEN"]);
  });

  it("never reports an optional field as missing", () => {
    const { missing } = collectSecrets(clickupPreset, { token: SECRET_VALUE, fields: {} });
    expect(missing).not.toContain("CLICKUP_TEAM_ID");
  });

  it("a preset with no secret fields never reports anything missing", () => {
    const { secrets, missing } = collectSecrets(customPreset, { fields: {} });
    expect(secrets).toEqual({});
    expect(missing).toEqual([]);
  });
});

describe("unknownFields", () => {
  it("returns [] when every provided field name is a known secretField", () => {
    expect(unknownFields(clickupPreset, ["CLICKUP_API_TOKEN", "CLICKUP_TEAM_ID"])).toEqual([]);
  });

  it("flags a typo'd field name not present in the preset's secretFields", () => {
    expect(unknownFields(clickupPreset, ["CLICKUP_API_TOKEN", "CLIKUP_TEAM_ID"])).toEqual(["CLIKUP_TEAM_ID"]);
  });

  it("flags multiple unknown field names, preserving order", () => {
    expect(unknownFields(clickupPreset, ["FOO", "CLICKUP_API_TOKEN", "BAR"])).toEqual(["FOO", "BAR"]);
  });

  it("returns [] for an empty provided list", () => {
    expect(unknownFields(clickupPreset, [])).toEqual([]);
  });

  it("a preset with no secretFields flags every provided name as unknown", () => {
    expect(unknownFields(customPreset, ["ANYTHING"])).toEqual(["ANYTHING"]);
  });
});

describe("secretsByKeychainKey", () => {
  it("reshapes a field->value map to keychainKey->value using the connection's secretRefs", () => {
    const conn: Connection = {
      id: "clickup",
      presetId: "clickup",
      label: "ClickUp",
      transport: clickupPreset.transport,
      secretRefs: [{ field: "CLICKUP_API_TOKEN", keychainKey: "mcp.clickup.CLICKUP_API_TOKEN", target: "env" }],
      enabled: false,
      status: "unconfigured",
    };
    const out = secretsByKeychainKey(conn, { CLICKUP_API_TOKEN: SECRET_VALUE });
    expect(out).toEqual({ "mcp.clickup.CLICKUP_API_TOKEN": SECRET_VALUE });
  });
});

describe("buildCustomTransport", () => {
  it("builds an http transport from --url", () => {
    const result = buildCustomTransport({ url: "https://example.com/mcp" });
    expect(result).toEqual({ transport: { kind: "http", url: "https://example.com/mcp", headers: {} } });
  });

  it("builds a stdio transport from --command and comma-split --args", () => {
    const result = buildCustomTransport({ command: "node", args: "server.js, --flag" });
    expect(result).toEqual({
      transport: { kind: "stdio", command: "node", args: ["server.js", "--flag"], env: {} },
    });
  });

  it("builds a stdio transport from --command alone (no args)", () => {
    const result = buildCustomTransport({ command: "node" });
    expect(result).toEqual({ transport: { kind: "stdio", command: "node", args: [], env: {} } });
  });

  it("errors when neither --command nor --url is given", () => {
    const result = buildCustomTransport({});
    expect("error" in result).toBe(true);
  });

  it("prefers --url over --command when both are given", () => {
    const result = buildCustomTransport({ url: "https://example.com/mcp", command: "node" });
    expect(result).toEqual({ transport: { kind: "http", url: "https://example.com/mcp", headers: {} } });
  });
});

describe("parseConnectArgv", () => {
  it("parses preset id + projectDir positionals with no flags", () => {
    expect(parseConnectArgv(["clickup", "/tmp/proj"])).toMatchObject({
      positional: ["clickup", "/tmp/proj"],
      token: undefined,
      fields: [],
      asTracker: false,
    });
  });

  it("consumes --token's value out of the positionals", () => {
    const parsed = parseConnectArgv(["clickup", "--token", SECRET_VALUE, "/tmp/proj"]);
    expect(parsed.positional).toEqual(["clickup", "/tmp/proj"]);
    expect(parsed.token).toBe(SECRET_VALUE);
  });

  it("collects repeated --field flags in order", () => {
    const parsed = parseConnectArgv(["clickup", "--field", "A=1", "--field", "B=2"]);
    expect(parsed.fields).toEqual(["A=1", "B=2"]);
    expect(parsed.positional).toEqual(["clickup"]);
  });

  it("sets asTracker for the --as-tracker boolean flag", () => {
    expect(parseConnectArgv(["clickup", "--as-tracker"]).asTracker).toBe(true);
    expect(parseConnectArgv(["clickup"]).asTracker).toBe(false);
  });

  it("parses --command/--args/--url without leaking their values into positionals", () => {
    const parsed = parseConnectArgv(["custom", "--command", "node", "--args", "server.js,--flag", "--url", "https://x"]);
    expect(parsed.positional).toEqual(["custom"]);
    expect(parsed.command).toBe("node");
    expect(parsed.args).toBe("server.js,--flag");
    expect(parsed.url).toBe("https://x");
  });

  it("never places a secret value in positional (never mistaken for a projectDir)", () => {
    const parsed = parseConnectArgv(["clickup", "--token", SECRET_VALUE]);
    expect(parsed.positional).not.toContain(SECRET_VALUE);
  });
});

describe("formatConnectionLine", () => {
  const base: Connection = {
    id: "clickup",
    presetId: "clickup",
    label: "ClickUp",
    transport: clickupPreset.transport,
    secretRefs: [{ field: "CLICKUP_API_TOKEN", keychainKey: "mcp.clickup.CLICKUP_API_TOKEN", target: "env" }],
    enabled: true,
    status: "connected",
    toolCount: 12,
  };

  it("renders id, label, status, and tool count", () => {
    expect(formatConnectionLine(base)).toBe("clickup · ClickUp · connected · 12 tools");
  });

  it("renders a tracker suffix when the connection is the tracker", () => {
    expect(formatConnectionLine({ ...base, role: "tracker" })).toBe(
      "clickup · ClickUp · connected · 12 tools · tracker"
    );
  });

  it("renders '-' tools when toolCount is unset", () => {
    expect(formatConnectionLine({ ...base, toolCount: undefined, status: "unconfigured" })).toBe(
      "clickup · ClickUp · unconfigured · - tools"
    );
  });

  it("never includes a secret value in its output", () => {
    expect(formatConnectionLine(base)).not.toContain(SECRET_VALUE);
    expect(formatConnectionLine({ ...base, role: "tracker" })).not.toContain(SECRET_VALUE);
  });
});
