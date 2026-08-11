import { describe, it, expect } from "vitest";
import {
  addConnection, updateConnection, removeConnection, setStatus,
  connectionsToFile, connectionsFromFile, uniqueId, type Connection,
} from "./connections";

const base: Connection = {
  id: "clickup", presetId: "clickup", label: "ClickUp",
  transport: { kind: "stdio", command: "npx", args: ["-y", "pkg"], env: {} },
  secretRefs: [{ field: "CLICKUP_API_TOKEN", keychainKey: "mcp.clickup.token", target: "env" }],
  enabled: true, status: "unconfigured",
};

describe("connections model", () => {
  it("adds, updates, removes, sets status", () => {
    let l = addConnection([], base);
    expect(l).toHaveLength(1);
    l = updateConnection(l, "clickup", { label: "CU" });
    expect(l[0].label).toBe("CU");
    l = setStatus(l, "clickup", "connected", { toolCount: 14 });
    expect(l[0]).toMatchObject({ status: "connected", toolCount: 14 });
    l = removeConnection(l, "clickup");
    expect(l).toHaveLength(0);
  });

  it("round-trips through file form and holds no secret values", () => {
    const raw = connectionsToFile([base]);
    expect(raw).toContain("mcp.clickup.token");
    expect(raw).not.toMatch(/token-[a-z0-9]{6,}/i); // no resolved secret shape
    expect(connectionsFromFile(raw)).toEqual([base]);
  });

  it("returns [] on malformed file", () => {
    expect(connectionsFromFile("{not json")).toEqual([]);
    expect(connectionsFromFile(JSON.stringify({ version: 99 }))).toEqual([]);
  });

  it("uniqueId disambiguates", () => {
    const l = addConnection([], base);
    expect(uniqueId(l, "clickup")).toBe("clickup-2");
    expect(uniqueId([], "clickup")).toBe("clickup");
  });
});
