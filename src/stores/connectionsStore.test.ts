import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Connection } from "../lib/mcp/connections";

// ---------------------------------------------------------------------------
// Mocks — invoke() and the keychain wrapper, pattern from trackerStore.test.ts.
// ---------------------------------------------------------------------------

const { invokeStub } = vi.hoisted(() => ({
  invokeStub: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeStub,
}));

const { secretSetStub, secretGetStub, secretDeleteStub } = vi.hoisted(() => ({
  secretSetStub: vi.fn().mockResolvedValue(undefined),
  secretGetStub: vi.fn().mockResolvedValue(null),
  secretDeleteStub: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/secrets", () => ({
  secretSet: secretSetStub,
  secretGet: secretGetStub,
  secretDelete: secretDeleteStub,
  secretHas: vi.fn().mockResolvedValue(false),
  isTauri: () => true,
}));

const { reportErrorStub } = vi.hoisted(() => ({
  reportErrorStub: vi.fn().mockReturnValue("reported error"),
}));

vi.mock("../lib/reportError", () => ({
  reportError: reportErrorStub,
  errorMessage: (e: unknown) => String(e),
}));

// Import the store AFTER the mocks are set up.
import { useConnectionsStore } from "./connectionsStore";
import { CATALOG } from "../lib/mcp/catalog";

const ROOT = "/project";

function stdioConnection(overrides?: Partial<Connection>): Connection {
  return {
    id: "clickup",
    presetId: "clickup",
    label: "ClickUp",
    transport: { kind: "stdio", command: "npx", args: ["-y", "@taazkareem/clickup-mcp-server"], env: {} },
    secretRefs: [{ field: "CLICKUP_API_TOKEN", keychainKey: "mcp.clickup.CLICKUP_API_TOKEN", target: "env" }],
    enabled: true,
    status: "unconfigured",
    ...overrides,
  };
}

/** Pull the `content` string passed to a specific write_text_file call whose path
 *  ends with `suffix`, or undefined if no such call was made. */
function writtenContent(suffix: string): string | undefined {
  const call = invokeStub.mock.calls.find(
    (c: unknown[]) => c[0] === "write_text_file" && (c[1] as { path: string }).path.endsWith(suffix)
  );
  return call ? (call[1] as { content: string }).content : undefined;
}

beforeEach(() => {
  invokeStub.mockReset();
  secretSetStub.mockReset().mockResolvedValue(undefined);
  secretGetStub.mockReset().mockResolvedValue(null);
  secretDeleteStub.mockReset().mockResolvedValue(undefined);
  reportErrorStub.mockReset().mockReturnValue("reported error");

  // Default: reads 404 (no file yet), writes succeed.
  invokeStub.mockImplementation((cmd: string) => {
    if (cmd === "read_file") return Promise.reject(new Error("not found"));
    if (cmd === "write_text_file") return Promise.resolve(undefined);
    if (cmd === "mcp_probe") return Promise.resolve(JSON.stringify({ ok: true, toolCount: 0, toolNames: [] }));
    return Promise.resolve(undefined);
  });

  useConnectionsStore.setState({ connections: [] });
});

// ---------------------------------------------------------------------------
// load()
// ---------------------------------------------------------------------------

describe("connectionsStore.load", () => {
  it("sets connections to [] and never throws when mcp.json is missing", async () => {
    await expect(useConnectionsStore.getState().load(ROOT)).resolves.toBeUndefined();
    expect(useConnectionsStore.getState().connections).toEqual([]);
  });

  it("sets connections to [] and never throws when mcp.json is malformed JSON", async () => {
    invokeStub.mockImplementation((cmd: string) => {
      if (cmd === "read_file") return Promise.resolve("{ not valid json");
      return Promise.resolve(undefined);
    });
    await expect(useConnectionsStore.getState().load(ROOT)).resolves.toBeUndefined();
    expect(useConnectionsStore.getState().connections).toEqual([]);
  });

  it("loads connections from a well-formed mcp.json", async () => {
    const conn = stdioConnection();
    invokeStub.mockImplementation((cmd: string) => {
      if (cmd === "read_file") return Promise.resolve(JSON.stringify({ version: 1, connections: [conn] }));
      return Promise.resolve(undefined);
    });
    await useConnectionsStore.getState().load(ROOT);
    expect(useConnectionsStore.getState().connections).toEqual([conn]);
  });
});

// ---------------------------------------------------------------------------
// upsert() — secrets go to keychain only, never into mcp.json content
// ---------------------------------------------------------------------------

describe("connectionsStore.upsert", () => {
  it("calls secretSet for each provided secret, before persisting", async () => {
    const conn = stdioConnection();
    await useConnectionsStore.getState().upsert(ROOT, conn, { CLICKUP_API_TOKEN: "pk_super_secret_value" });

    expect(secretSetStub).toHaveBeenCalledWith("mcp.clickup.CLICKUP_API_TOKEN", "pk_super_secret_value");
    expect(useConnectionsStore.getState().connections).toEqual([conn]);
  });

  it("writes mcp.json containing the keychain ref but NOT the secret value", async () => {
    const conn = stdioConnection();
    await useConnectionsStore.getState().upsert(ROOT, conn, { CLICKUP_API_TOKEN: "pk_super_secret_value" });

    const content = writtenContent(".cadre/mcp.json");
    expect(content).toBeDefined();
    expect(content).toContain("mcp.clickup.CLICKUP_API_TOKEN");
    expect(content).not.toContain("pk_super_secret_value");
  });

  it("skips secretSet for fields not present in the provided secrets map", async () => {
    const conn = stdioConnection();
    await useConnectionsStore.getState().upsert(ROOT, conn, {});
    expect(secretSetStub).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// addFromPreset()
// ---------------------------------------------------------------------------

describe("connectionsStore.addFromPreset", () => {
  it("seeds a connection from a preset, adds it to state, and returns it", () => {
    const preset = CATALOG.find((p) => p.id === "clickup")!;
    const conn = useConnectionsStore.getState().addFromPreset(preset);

    expect(conn.presetId).toBe("clickup");
    expect(conn.secretRefs.map((r) => r.field)).toContain("CLICKUP_API_TOKEN");
    expect(conn.enabled).toBe(false);
    expect(useConnectionsStore.getState().connections).toContainEqual(conn);
  });
});

// ---------------------------------------------------------------------------
// setEnabled()
// ---------------------------------------------------------------------------

describe("connectionsStore.setEnabled", () => {
  it("flips enabled, persists mcp.json, and re-materializes the fleet", async () => {
    useConnectionsStore.setState({ connections: [stdioConnection({ enabled: false })] });

    await useConnectionsStore.getState().setEnabled(ROOT, "clickup", true);

    expect(useConnectionsStore.getState().connections[0].enabled).toBe(true);
    expect(writtenContent(".cadre/mcp.json")).toBeDefined();
    expect(writtenContent(".cadre/fleet.mcp.json")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// remove()
// ---------------------------------------------------------------------------

describe("connectionsStore.remove", () => {
  it("deletes the connection's keychain secrets and removes it from state", async () => {
    const conn = stdioConnection();
    useConnectionsStore.setState({ connections: [conn] });

    await useConnectionsStore.getState().remove(ROOT, conn.id);

    expect(secretDeleteStub).toHaveBeenCalledWith("mcp.clickup.CLICKUP_API_TOKEN");
    expect(useConnectionsStore.getState().connections).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// materializeFleet()
// ---------------------------------------------------------------------------

describe("connectionsStore.materializeFleet", () => {
  it("writes fleet.mcp.json with ${VAR} placeholders, not raw secrets", async () => {
    useConnectionsStore.setState({ connections: [stdioConnection()] });

    const { path, requiredSecrets } = await useConnectionsStore.getState().materializeFleet(ROOT);

    expect(path).toBe(`${ROOT}/.cadre/fleet.mcp.json`);
    expect(requiredSecrets).toEqual([{ envVar: "CLICKUP_API_TOKEN", keychainKey: "mcp.clickup.CLICKUP_API_TOKEN" }]);

    const content = writtenContent(".cadre/fleet.mcp.json");
    expect(content).toBeDefined();
    expect(content).toContain("${CLICKUP_API_TOKEN}");
  });

  it("appends both mcp gitignore lines when the .gitignore is absent", async () => {
    useConnectionsStore.setState({ connections: [stdioConnection()] });
    // read_file for .gitignore rejects (missing) via the default beforeEach mock.

    await useConnectionsStore.getState().materializeFleet(ROOT);

    const content = writtenContent(".gitignore");
    expect(content).toBeDefined();
    expect(content).toContain(".cadre/fleet.mcp.json");
    expect(content).toContain(".cadre/mcp.json");
  });

  it("does not duplicate gitignore lines that are already present", async () => {
    useConnectionsStore.setState({ connections: [stdioConnection()] });
    invokeStub.mockImplementation((cmd: string, args?: { path?: string }) => {
      if (cmd === "read_file" && args?.path?.endsWith(".gitignore")) {
        return Promise.resolve("node_modules\n.cadre/fleet.mcp.json\n.cadre/mcp.json\n");
      }
      if (cmd === "read_file") return Promise.reject(new Error("not found"));
      return Promise.resolve(undefined);
    });

    await useConnectionsStore.getState().materializeFleet(ROOT);

    const gitignoreWrite = invokeStub.mock.calls.find(
      (c: unknown[]) => c[0] === "write_text_file" && (c[1] as { path: string }).path.endsWith(".gitignore")
    );
    expect(gitignoreWrite).toBeUndefined();
  });

  it("appends ONLY the missing line when .gitignore already has fleet but not mcp.json", async () => {
    useConnectionsStore.setState({ connections: [stdioConnection()] });
    invokeStub.mockImplementation((cmd: string, args?: { path?: string }) => {
      if (cmd === "read_file" && args?.path?.endsWith(".gitignore")) {
        return Promise.resolve("node_modules\n.cadre/fleet.mcp.json\n");
      }
      if (cmd === "read_file") return Promise.reject(new Error("not found"));
      return Promise.resolve(undefined);
    });

    await useConnectionsStore.getState().materializeFleet(ROOT);

    const content = writtenContent(".gitignore");
    expect(content).toBeDefined();
    // The absent line was appended...
    expect(content).toContain(".cadre/mcp.json");
    // ...and the already-present fleet line was NOT duplicated.
    const fleetOccurrences = content!.split("\n").filter((l) => l.trim() === ".cadre/fleet.mcp.json").length;
    expect(fleetOccurrences).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// resolveFleetEnv()
// ---------------------------------------------------------------------------

describe("connectionsStore.resolveFleetEnv", () => {
  it("returns env resolved from the keychain for an enabled connection", async () => {
    useConnectionsStore.setState({ connections: [stdioConnection()] });
    secretGetStub.mockResolvedValue("pk_resolved_value");

    const result = await useConnectionsStore.getState().resolveFleetEnv(ROOT);

    expect(secretGetStub).toHaveBeenCalledWith("mcp.clickup.CLICKUP_API_TOKEN");
    expect(result).toEqual({
      mcpConfigPath: `${ROOT}/.cadre/fleet.mcp.json`,
      env: { CLICKUP_API_TOKEN: "pk_resolved_value" },
    });
  });

  it("drops the connection, reports a warning, and returns null when its only secret is missing", async () => {
    useConnectionsStore.setState({ connections: [stdioConnection()] });
    secretGetStub.mockResolvedValue(null);

    const result = await useConnectionsStore.getState().resolveFleetEnv(ROOT);

    // The whole fleet must not be poisoned by one unresolvable ${VAR}: the
    // server that can't resolve its secret is dropped entirely, and since it
    // was the only enabled connection, the fleet launches without MCP.
    expect(result).toBeNull();
    expect(reportErrorStub).toHaveBeenCalled();

    const content = writtenContent(".cadre/fleet.mcp.json");
    expect(content).toBeDefined(); // enabled connections existed, so the (filtered, empty) file is still written to clear stale content
    expect(content).not.toContain("${CLICKUP_API_TOKEN}");
    expect(content).not.toContain('"clickup"');
  });

  it("keeps the surviving connection and drops the one with a missing secret, when one of two enabled connections resolves", async () => {
    const good = stdioConnection({ id: "clickup", label: "ClickUp" });
    const bad = stdioConnection({
      id: "github",
      presetId: "github",
      label: "GitHub",
      transport: { kind: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: {} },
      secretRefs: [{ field: "GITHUB_TOKEN", keychainKey: "mcp.github.GITHUB_TOKEN", target: "env" }],
    });
    useConnectionsStore.setState({ connections: [good, bad] });
    secretGetStub.mockImplementation((key: string) =>
      Promise.resolve(key === "mcp.clickup.CLICKUP_API_TOKEN" ? "pk_good" : null)
    );

    const result = await useConnectionsStore.getState().resolveFleetEnv(ROOT);

    expect(result).not.toBeNull();
    expect(result?.env).toEqual({ CLICKUP_API_TOKEN: "pk_good" });
    expect(Object.keys(result?.env ?? {})).not.toContain("GITHUB_TOKEN");
    expect(reportErrorStub).toHaveBeenCalled(); // warned about the dropped GitHub connection

    const content = writtenContent(".cadre/fleet.mcp.json");
    expect(content).toContain("${CLICKUP_API_TOKEN}");
    expect(content).not.toContain("${GITHUB_TOKEN}");
    expect(content).not.toContain('"github"');
  });

  it("returns null and writes NOTHING (no fleet file, no gitignore mutation) when there are no enabled connections", async () => {
    useConnectionsStore.setState({ connections: [stdioConnection({ enabled: false })] });

    const result = await useConnectionsStore.getState().resolveFleetEnv(ROOT);

    expect(result).toBeNull();
    expect(writtenContent(".cadre/fleet.mcp.json")).toBeUndefined();
    expect(writtenContent(".gitignore")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// setRole()
// ---------------------------------------------------------------------------

describe("connectionsStore.setRole", () => {
  it("applies the role to the connection and persists mcp.json with it", async () => {
    const conn = stdioConnection();
    useConnectionsStore.setState({ connections: [conn] });

    await useConnectionsStore.getState().setRole(ROOT, "clickup", "tracker");

    expect(useConnectionsStore.getState().connections[0].role).toBe("tracker");
    const content = writtenContent(".cadre/mcp.json");
    expect(content).toBeDefined();
    expect(content).toContain('"role": "tracker"');
  });

  it("clears the role and persists mcp.json without it", async () => {
    const conn = stdioConnection({ role: "tracker" });
    useConnectionsStore.setState({ connections: [conn] });

    await useConnectionsStore.getState().setRole(ROOT, "clickup", undefined);

    expect(useConnectionsStore.getState().connections[0].role).toBeUndefined();
    const content = writtenContent(".cadre/mcp.json");
    expect(content).toBeDefined();
    expect(content).not.toContain('"role"');
  });
});

// ---------------------------------------------------------------------------
// resolveTrackerEnv()
// ---------------------------------------------------------------------------

describe("connectionsStore.resolveTrackerEnv", () => {
  it("writes tracker.mcp.json with ${VAR} placeholders and returns {mcpConfigPath, env, serverKey} for a designated+resolvable tracker", async () => {
    useConnectionsStore.setState({ connections: [stdioConnection({ role: "tracker" })] });
    secretGetStub.mockResolvedValue("pk_resolved_value");

    const result = await useConnectionsStore.getState().resolveTrackerEnv(ROOT);

    expect(secretGetStub).toHaveBeenCalledWith("mcp.clickup.CLICKUP_API_TOKEN");
    expect(result).toEqual({
      mcpConfigPath: `${ROOT}/.cadre/tracker.mcp.json`,
      env: { CLICKUP_API_TOKEN: "pk_resolved_value" },
      serverKey: "clickup",
    });

    const content = writtenContent(".cadre/tracker.mcp.json");
    expect(content).toBeDefined();
    expect(content).toContain("${CLICKUP_API_TOKEN}");
    expect(content).not.toContain("pk_resolved_value");
  });

  it("appends .cadre/tracker.mcp.json to .gitignore", async () => {
    useConnectionsStore.setState({ connections: [stdioConnection({ role: "tracker" })] });
    secretGetStub.mockResolvedValue("pk_resolved_value");

    await useConnectionsStore.getState().resolveTrackerEnv(ROOT);

    const content = writtenContent(".gitignore");
    expect(content).toBeDefined();
    expect(content).toContain(".cadre/tracker.mcp.json");
  });

  it("returns null, reportErrors, and leaves no server in the written file when the tracker's secret is missing", async () => {
    useConnectionsStore.setState({ connections: [stdioConnection({ role: "tracker" })] });
    secretGetStub.mockResolvedValue(null);

    const result = await useConnectionsStore.getState().resolveTrackerEnv(ROOT);

    expect(result).toBeNull();
    expect(reportErrorStub).toHaveBeenCalled();

    // A tracker connection existed, so the (filtered, empty) config is still
    // written to clear any stale content — matching resolveFleetEnv. The
    // unresolvable server must NOT appear in it.
    const content = writtenContent(".cadre/tracker.mcp.json");
    expect(content).toBeDefined();
    expect(content).not.toContain("${CLICKUP_API_TOKEN}");
    expect(content).not.toContain('"clickup"');
  });

  it("returns null and writes NOTHING when there is no tracker connection", async () => {
    useConnectionsStore.setState({ connections: [stdioConnection({ role: undefined })] });

    const result = await useConnectionsStore.getState().resolveTrackerEnv(ROOT);

    expect(result).toBeNull();
    expect(writtenContent(".cadre/tracker.mcp.json")).toBeUndefined();
    expect(writtenContent(".gitignore")).toBeUndefined();
  });

  it("returns null (not a phantom config path) when the tracker config write rejects", async () => {
    useConnectionsStore.setState({ connections: [stdioConnection({ role: "tracker" })] });
    secretGetStub.mockResolvedValue("pk_resolved_value");
    invokeStub.mockImplementation((cmd: string) => {
      if (cmd === "write_text_file") return Promise.reject(new Error("disk full"));
      if (cmd === "read_file") return Promise.reject(new Error("not found"));
      return Promise.resolve(undefined);
    });

    const result = await useConnectionsStore.getState().resolveTrackerEnv(ROOT);

    expect(result).toBeNull();
    expect(reportErrorStub).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// probe()
// ---------------------------------------------------------------------------

describe("connectionsStore.probe", () => {
  it("parses a successful mcp_probe result and sets status=connected", async () => {
    const conn = stdioConnection();
    useConnectionsStore.setState({ connections: [conn] });
    invokeStub.mockImplementation((cmd: string) => {
      if (cmd === "mcp_probe")
        return Promise.resolve(JSON.stringify({ ok: true, toolCount: 3, toolNames: ["a", "b", "c"] }));
      return Promise.resolve(undefined);
    });

    const result = await useConnectionsStore.getState().probe(conn);

    expect(result).toEqual({ ok: true, toolCount: 3, toolNames: ["a", "b", "c"] });
    expect(useConnectionsStore.getState().connections[0].status).toBe("connected");
    expect(useConnectionsStore.getState().connections[0].toolCount).toBe(3);
  });

  it("parses a failed mcp_probe result and sets status=error with lastError", async () => {
    const conn = stdioConnection();
    useConnectionsStore.setState({ connections: [conn] });
    invokeStub.mockImplementation((cmd: string) => {
      if (cmd === "mcp_probe")
        return Promise.resolve(JSON.stringify({ ok: false, toolCount: 0, toolNames: [], error: "spawn ENOENT" }));
      return Promise.resolve(undefined);
    });

    const result = await useConnectionsStore.getState().probe(conn);

    expect(result.ok).toBe(false);
    expect(useConnectionsStore.getState().connections[0].status).toBe("error");
    expect(useConnectionsStore.getState().connections[0].lastError).toBe("spawn ENOENT");
  });

  it("stages provided secrets to the keychain before probing", async () => {
    const conn = stdioConnection();
    await useConnectionsStore.getState().probe(conn, { CLICKUP_API_TOKEN: "pk_temp" });
    expect(secretSetStub).toHaveBeenCalledWith("mcp.clickup.CLICKUP_API_TOKEN", "pk_temp");
  });

  it("reportErrors and sets status=error when mcp_probe itself rejects", async () => {
    const conn = stdioConnection();
    useConnectionsStore.setState({ connections: [conn] });
    invokeStub.mockImplementation((cmd: string) => {
      if (cmd === "mcp_probe") return Promise.reject(new Error("probe crashed"));
      return Promise.resolve(undefined);
    });

    const result = await useConnectionsStore.getState().probe(conn);

    expect(reportErrorStub).toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(useConnectionsStore.getState().connections[0].status).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// Error paths — an actual invoke() rejection must reportError and must NOT
// leave callers pointing at a phantom, never-written fleet config.
// ---------------------------------------------------------------------------

describe("connectionsStore — invoke rejection handling", () => {
  it("materializeFleet reportErrors AND rethrows when write_text_file rejects", async () => {
    useConnectionsStore.setState({ connections: [stdioConnection()] });
    invokeStub.mockImplementation((cmd: string) => {
      if (cmd === "write_text_file") return Promise.reject(new Error("disk full"));
      if (cmd === "read_file") return Promise.reject(new Error("not found"));
      return Promise.resolve(undefined);
    });

    await expect(useConnectionsStore.getState().materializeFleet(ROOT)).rejects.toThrow("disk full");
    expect(reportErrorStub).toHaveBeenCalled();
  });

  it("resolveFleetEnv returns null (not a phantom config path) when the fleet write rejects", async () => {
    useConnectionsStore.setState({ connections: [stdioConnection()] });
    invokeStub.mockImplementation((cmd: string) => {
      if (cmd === "write_text_file") return Promise.reject(new Error("disk full"));
      if (cmd === "read_file") return Promise.reject(new Error("not found"));
      return Promise.resolve(undefined);
    });

    const result = await useConnectionsStore.getState().resolveFleetEnv(ROOT);

    expect(result).toBeNull();
    expect(reportErrorStub).toHaveBeenCalled();
  });

  it("upsert reportErrors (via materializeFleet) but still resolves when the write rejects", async () => {
    const conn = stdioConnection();
    invokeStub.mockImplementation((cmd: string) => {
      if (cmd === "write_text_file") return Promise.reject(new Error("disk full"));
      if (cmd === "read_file") return Promise.reject(new Error("not found"));
      return Promise.resolve(undefined);
    });

    await expect(
      useConnectionsStore.getState().upsert(ROOT, conn, { CLICKUP_API_TOKEN: "pk_x" })
    ).resolves.toBeUndefined();
    // Secret still staged to the keychain; the failure was surfaced.
    expect(secretSetStub).toHaveBeenCalledWith("mcp.clickup.CLICKUP_API_TOKEN", "pk_x");
    expect(reportErrorStub).toHaveBeenCalled();
  });
});
