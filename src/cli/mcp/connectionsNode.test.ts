import { describe, it, expect } from "vitest";

import { type Connection, connectionsToFile } from "../../lib/mcp/connections";
import { materialize, serializeConfig } from "../../lib/mcp/materialize";
import {
  type NodeIo,
  readConnections,
  writeConnections,
  upsertConnection,
  removeConnection,
  setRoleNode,
  materializeFleetNode,
  resolveTrackerEnvNode,
} from "./connectionsNode";

const root = "/proj";
const mcpJsonPath = `${root}/.cadre/mcp.json`;
const fleetJsonPath = `${root}/.cadre/fleet.mcp.json`;
const trackerJsonPath = `${root}/.cadre/tracker.mcp.json`;
const gitignorePath = `${root}/.gitignore`;

/** In-memory NodeIo fake: Map-backed keychain + filesystem. */
function fakeIo(): NodeIo & { secrets: Map<string, string>; files: Map<string, string> } {
  const secrets = new Map<string, string>();
  const files = new Map<string, string>();
  return {
    secrets,
    files,
    async getSecret(key: string) {
      return secrets.has(key) ? (secrets.get(key) as string) : null;
    },
    async setSecret(key: string, value: string) {
      secrets.set(key, value);
    },
    async deleteSecret(key: string) {
      secrets.delete(key);
    },
    async readFile(path: string) {
      return files.has(path) ? (files.get(path) as string) : null;
    },
    async writeFile(path: string, content: string) {
      files.set(path, content);
    },
  };
}

const clickup: Connection = {
  id: "clickup",
  presetId: "clickup",
  label: "ClickUp",
  transport: { kind: "stdio", command: "npx", args: ["-y", "@taazkareem/clickup-mcp-server"], env: {} },
  secretRefs: [{ field: "CLICKUP_API_TOKEN", keychainKey: "mcp.clickup.CLICKUP_API_TOKEN", target: "env" }],
  enabled: true,
  status: "unconfigured",
};

const github: Connection = {
  id: "github",
  presetId: "github",
  label: "GitHub",
  transport: { kind: "http", url: "https://api.github.com/mcp", headers: {} },
  secretRefs: [{ field: "GITHUB_TOKEN", keychainKey: "mcp.github.GITHUB_TOKEN", target: "header" }],
  enabled: false,
  status: "unconfigured",
};

const SECRET_VALUE = "sk-super-secret-clickup-token-123";

describe("connectionsNode: upsertConnection", () => {
  it("stages secrets to the keychain and writes refs (not values) to mcp.json + fleet.mcp.json", async () => {
    const io = fakeIo();
    await upsertConnection(io, root, clickup, { CLICKUP_API_TOKEN: SECRET_VALUE });

    expect(io.secrets.get("mcp.clickup.CLICKUP_API_TOKEN")).toBe(SECRET_VALUE);

    const registry = io.files.get(mcpJsonPath);
    expect(registry).toBeDefined();
    expect(registry).toContain("mcp.clickup.CLICKUP_API_TOKEN");
    expect(registry).not.toContain(SECRET_VALUE);

    const fleet = io.files.get(fleetJsonPath);
    expect(fleet).toBeDefined();
    expect(fleet).toContain("${CLICKUP_API_TOKEN}");
    expect(fleet).not.toContain(SECRET_VALUE);

    const gitignore = io.files.get(gitignorePath);
    expect(gitignore).toBeDefined();
    expect(gitignore).toContain(".cadre/fleet.mcp.json");
    expect(gitignore).toContain(".cadre/mcp.json");
  });

  it("round-trips through readConnections", async () => {
    const io = fakeIo();
    await upsertConnection(io, root, clickup, { CLICKUP_API_TOKEN: SECRET_VALUE });
    const list = await readConnections(io, root);
    expect(list).toEqual([clickup]);
  });
});

describe("connectionsNode: drift guard (byte-identical to connectionsStore)", () => {
  const fixedList: Connection[] = [clickup, github];

  it("writeConnections bytes === connectionsToFile(list)", async () => {
    const io = fakeIo();
    await writeConnections(io, root, fixedList);
    const written = io.files.get(mcpJsonPath);
    expect(written).toBe(connectionsToFile(fixedList));
  });

  it("materializeFleetNode bytes === serializeConfig(materialize(list))", async () => {
    const io = fakeIo();
    await writeConnections(io, root, fixedList);
    await materializeFleetNode(io, root);
    const written = io.files.get(fleetJsonPath);
    expect(written).toBe(serializeConfig(materialize(fixedList)));
  });
});

describe("connectionsNode: resolveTrackerEnvNode", () => {
  const tracker: Connection = {
    id: "tracker-conn",
    presetId: "clickup",
    label: "Tracker",
    transport: { kind: "stdio", command: "npx", args: ["-y", "tracker-mcp"], env: {} },
    secretRefs: [{ field: "TRACKER_TOKEN", keychainKey: "mcp.tracker-conn.TRACKER_TOKEN", target: "env" }],
    enabled: true,
    status: "unconfigured",
    role: "tracker",
  };

  it("resolvable tracker -> env + writes tracker.mcp.json with ${VAR}", async () => {
    const io = fakeIo();
    await writeConnections(io, root, [tracker]);
    await io.setSecret("mcp.tracker-conn.TRACKER_TOKEN", "tval-123");

    const result = await resolveTrackerEnvNode(io, root);
    expect(result).toEqual({
      mcpConfigPath: trackerJsonPath,
      env: { TRACKER_TOKEN: "tval-123" },
      serverKey: "tracker-conn",
    });

    const written = io.files.get(trackerJsonPath);
    expect(written).toBeDefined();
    expect(written).toContain("${TRACKER_TOKEN}");
    expect(written).not.toContain("tval-123");

    const gitignore = io.files.get(gitignorePath);
    expect(gitignore).toContain(".cadre/tracker.mcp.json");
  });

  it("missing secret -> null, but tracker.mcp.json is (re)written empty to clear stale content", async () => {
    const io = fakeIo();
    await writeConnections(io, root, [tracker]);
    // No secret staged in the keychain fake.

    const result = await resolveTrackerEnvNode(io, root);
    expect(result).toBeNull();

    const written = io.files.get(trackerJsonPath);
    expect(written).toBeDefined();
    expect(written).toBe(serializeConfig(materialize([])));
  });

  it("no tracker connection designated -> null, no write", async () => {
    const io = fakeIo();
    await writeConnections(io, root, [clickup]); // no role: "tracker"

    const result = await resolveTrackerEnvNode(io, root);
    expect(result).toBeNull();
    expect(io.files.has(trackerJsonPath)).toBe(false);
  });
});

describe("connectionsNode: removeConnection", () => {
  it("deletes the connection's keychain secrets and re-materializes without it", async () => {
    const io = fakeIo();
    await upsertConnection(io, root, clickup, { CLICKUP_API_TOKEN: SECRET_VALUE });
    await upsertConnection(io, root, github, {});

    await removeConnection(io, root, "clickup");

    expect(await io.getSecret("mcp.clickup.CLICKUP_API_TOKEN")).toBeNull();

    const list = await readConnections(io, root);
    expect(list.map((c) => c.id)).toEqual(["github"]);

    const fleet = io.files.get(fleetJsonPath);
    expect(fleet).toBe(serializeConfig(materialize([github])));
    expect(fleet).not.toContain("clickup");
  });
});

describe("connectionsNode: setRoleNode", () => {
  it("sets the role and clears it from any other connection, then persists", async () => {
    const io = fakeIo();
    const a: Connection = { ...clickup, role: "tracker" };
    await writeConnections(io, root, [a, github]);

    await setRoleNode(io, root, "github", "tracker");

    const list = await readConnections(io, root);
    expect(list.find((c) => c.id === "clickup")?.role).toBeUndefined();
    expect(list.find((c) => c.id === "github")?.role).toBe("tracker");
  });
});

describe("connectionsNode: no secret value ever lands in a written file", () => {
  it("across upsert + resolveTrackerEnvNode, only ${VAR} placeholders and refs appear on disk", async () => {
    const io = fakeIo();
    const tracker: Connection = {
      id: "tracker-conn",
      presetId: "clickup",
      label: "Tracker",
      transport: { kind: "stdio", command: "npx", args: ["-y", "tracker-mcp"], env: {} },
      secretRefs: [{ field: "TRACKER_TOKEN", keychainKey: "mcp.tracker-conn.TRACKER_TOKEN", target: "env" }],
      enabled: true,
      status: "unconfigured",
      role: "tracker",
    };
    const trackerSecret = "tracker-super-secret-value";

    await upsertConnection(io, root, clickup, { CLICKUP_API_TOKEN: SECRET_VALUE });
    await upsertConnection(io, root, tracker, { TRACKER_TOKEN: trackerSecret });
    await resolveTrackerEnvNode(io, root);

    for (const [, content] of io.files) {
      expect(content).not.toContain(SECRET_VALUE);
      expect(content).not.toContain(trackerSecret);
    }
  });
});
