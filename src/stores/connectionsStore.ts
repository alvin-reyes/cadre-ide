import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import {
  type Connection,
  addConnection,
  updateConnection,
  removeConnection,
  setStatus,
  connectionsToFile,
  connectionsFromFile,
} from "../lib/mcp/connections";
import { type Preset, presetToConnection } from "../lib/mcp/catalog";
import { materialize, serializeConfig, type RequiredSecret } from "../lib/mcp/materialize";
import { secretSet, secretGet, secretDelete } from "../lib/secrets";
import { reportError } from "../lib/reportError";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Mirrors src/cli/mcp/client.ts's McpProbe — kept local so this store (browser
 *  bundle) never pulls in the CLI's Node-only MCP SDK imports. */
export interface McpProbe {
  ok: boolean;
  toolCount: number;
  toolNames: string[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Path + persist helpers
// ---------------------------------------------------------------------------

const mcpJsonPath = (root: string) => `${root}/.cadre/mcp.json`;
const fleetJsonPath = (root: string) => `${root}/.cadre/fleet.mcp.json`;
const gitignorePath = (root: string) => `${root}/.gitignore`;

/** Read a text file via the "read_file" Tauri command, tolerating a missing file. */
async function tryReadFile(path: string): Promise<string | null> {
  try {
    return await invoke<string>("read_file", { path });
  } catch {
    return null;
  }
}

/** Append any of `lines` that are not already present (exact line match) to the
 *  file at `path`, creating it if absent. No-op if all lines already present. */
async function appendIfMissing(path: string, lines: string[]): Promise<void> {
  const existing = (await tryReadFile(path)) ?? "";
  const existingLines = new Set(existing.split("\n").map((l) => l.trim()));
  const missing = lines.filter((l) => !existingLines.has(l));
  if (missing.length === 0) return;
  const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  const next = existing + sep + missing.join("\n") + "\n";
  await invoke("write_text_file", { path, content: next });
}

// ---------------------------------------------------------------------------
// Zustand store
// ---------------------------------------------------------------------------

interface ConnectionsState {
  connections: Connection[];

  /** Read `.cadre/mcp.json`; missing/malformed → []. Never throws. */
  load(root: string): Promise<void>;

  /** Write `.cadre/mcp.json` (refs only — never secret values). */
  save(root: string): Promise<void>;

  /** Seed a new Connection from a catalog preset and add it to state. Does not persist. */
  addFromPreset(preset: Preset): Connection;

  /** Stage secrets to the keychain, upsert the connection, persist, and materialize the fleet config. */
  upsert(root: string, conn: Connection, secrets: Record<string, string>): Promise<void>;

  /** Delete the connection's keychain secrets, remove it, persist, and re-materialize. */
  remove(root: string, id: string): Promise<void>;

  /** Flip enabled, persist, and re-materialize. */
  setEnabled(root: string, id: string, on: boolean): Promise<void>;

  /** Probe a connection (optionally staging secrets first) and update its status. */
  probe(conn: Connection, secrets?: Record<string, string>): Promise<McpProbe>;

  /** Write `.cadre/fleet.mcp.json` (${VAR} placeholders) and ensure both mcp files are gitignored. */
  materializeFleet(root: string): Promise<{ path: string; requiredSecrets: RequiredSecret[] }>;

  /** Resolve the fleet's required secrets from the keychain for spawning claude. */
  resolveFleetEnv(root: string): Promise<{ mcpConfigPath: string; env: Record<string, string> } | null>;
}

export const useConnectionsStore = create<ConnectionsState>((set, get) => ({
  connections: [],

  load: async (root: string) => {
    const raw = await tryReadFile(mcpJsonPath(root));
    if (raw === null) {
      // No mcp.json yet — the normal state for a fresh project, not an error.
      set({ connections: [] });
      return;
    }
    try {
      JSON.parse(raw);
    } catch (e) {
      reportError("mcp connections: load", e, {
        toastMessage: "MCP connections file is corrupted — starting with an empty registry.",
      });
      set({ connections: [] });
      return;
    }
    // connectionsFromFile itself tolerates a bad shape (returns []); the JSON.parse
    // above is only to detect and warn about truly malformed content once.
    set({ connections: connectionsFromFile(raw) });
  },

  save: async (root: string) => {
    try {
      await invoke("write_text_file", {
        path: mcpJsonPath(root),
        content: connectionsToFile(get().connections),
      });
    } catch (e) {
      reportError("mcp connections: save", e);
    }
  },

  addFromPreset: (preset: Preset) => {
    const conn = presetToConnection(preset, get().connections);
    set({ connections: addConnection(get().connections, conn) });
    return conn;
  },

  upsert: async (root: string, conn: Connection, secrets: Record<string, string>) => {
    try {
      for (const ref of conn.secretRefs) {
        const value = secrets[ref.field];
        if (value !== undefined) {
          await secretSet(ref.keychainKey, value);
        }
      }
      set({ connections: addConnection(get().connections, conn) });
    } catch (e) {
      reportError("mcp connections: upsert", e);
      return;
    }
    await get().save(root);
    // materializeFleet reports + rethrows on its own failure; swallow the rethrow
    // here so the mutator still resolves (the error was already surfaced).
    await get().materializeFleet(root).catch(() => {});
  },

  remove: async (root: string, id: string) => {
    try {
      const conn = get().connections.find((c) => c.id === id);
      if (conn) {
        for (const ref of conn.secretRefs) {
          await secretDelete(ref.keychainKey);
        }
      }
      set({ connections: removeConnection(get().connections, id) });
    } catch (e) {
      reportError("mcp connections: remove", e);
      return;
    }
    await get().save(root);
    await get().materializeFleet(root).catch(() => {});
  },

  setEnabled: async (root: string, id: string, on: boolean) => {
    set({ connections: updateConnection(get().connections, id, { enabled: on }) });
    await get().save(root);
    await get().materializeFleet(root).catch(() => {});
  },

  probe: async (conn: Connection, secrets?: Record<string, string>) => {
    try {
      if (secrets) {
        for (const ref of conn.secretRefs) {
          const value = secrets[ref.field];
          if (value !== undefined) {
            await secretSet(ref.keychainKey, value);
          }
        }
      }
      const raw = await invoke<string>("mcp_probe", { connectionJson: JSON.stringify(conn) });
      const result = JSON.parse(raw) as McpProbe;
      set({
        connections: setStatus(get().connections, conn.id, result.ok ? "connected" : "error", {
          toolCount: result.toolCount,
          lastError: result.error,
        }),
      });
      return result;
    } catch (e) {
      const message = reportError("mcp connections: probe", e);
      set({ connections: setStatus(get().connections, conn.id, "error", { lastError: message }) });
      return { ok: false, toolCount: 0, toolNames: [], error: message };
    }
  },

  materializeFleet: async (root: string) => {
    const m = materialize(get().connections);
    const path = fleetJsonPath(root);
    try {
      await invoke("write_text_file", { path, content: serializeConfig(m) });
      await appendIfMissing(gitignorePath(root), [".cadre/fleet.mcp.json", ".cadre/mcp.json"]);
    } catch (e) {
      // Fail loud: NEVER return a success-shaped result when the config (or its
      // gitignore guard) wasn't actually written — a phantom path would make the
      // fleet spawn Claude with --mcp-config pointing at a file that doesn't exist.
      reportError("mcp connections: materialize", e);
      throw e;
    }
    return { path, requiredSecrets: m.requiredSecrets };
  },

  resolveFleetEnv: async (root: string) => {
    let path: string;
    let requiredSecrets: RequiredSecret[];
    try {
      ({ path, requiredSecrets } = await get().materializeFleet(root));
    } catch {
      // materializeFleet already reported. Return null so the fleet launches
      // WITHOUT MCP (the same graceful path as "no connections") rather than
      // pointing the spawn at a config file that was never written.
      return null;
    }
    const env: Record<string, string> = {};
    for (const { envVar, keychainKey } of requiredSecrets) {
      const value = await secretGet(keychainKey);
      if (value === null) {
        reportError(
          "mcp connections: resolveFleetEnv",
          `Missing keychain secret for ${envVar} (key "${keychainKey}") — that connection will be skipped.`,
        );
        continue;
      }
      env[envVar] = value;
    }
    const hasEnabledConnections = get().connections.some((c) => c.enabled);
    if (!hasEnabledConnections) return null;
    return { mcpConfigPath: path, env };
  },
}));
