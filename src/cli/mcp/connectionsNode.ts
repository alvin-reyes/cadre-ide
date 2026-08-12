/**
 * Node twin of `src/stores/connectionsStore.ts` — same pure cores
 * (`src/lib/mcp/connections.ts`, `src/lib/mcp/materialize.ts`,
 * `src/lib/mcp/gitignore.ts`), Node I/O instead of Tauri `invoke` + the
 * browser-only `src/lib/secrets.ts`. Every write MUST be byte-identical to
 * what the desktop store produces for the same connection list — that's the
 * anti-drift contract this module exists to uphold (see
 * `connectionsNode.test.ts`'s drift-guard tests).
 *
 * Filenames + gitignore lines mirror the store exactly:
 *   .cadre/mcp.json          — connection registry (refs only, never secret values)
 *   .cadre/fleet.mcp.json    — materialized fleet config (${VAR} placeholders);
 *                              gitignores BOTH .cadre/fleet.mcp.json and .cadre/mcp.json
 *   .cadre/tracker.mcp.json  — single-connection tracker config (${VAR} placeholders);
 *                              gitignores .cadre/tracker.mcp.json
 *
 * Survivors-only resolution (resolveTrackerEnvNode): a connection is only
 * materialized into a resolve* config if ALL of its secretRefs resolve from
 * the keychain; otherwise it's dropped. The config is still written from the
 * survivors — even if that's empty — so a previous run's stale/unresolvable
 * server never lingers in a file `claude --mcp-config` would read.
 */

import { execFile } from "node:child_process";
import { mkdir, readFile as fsReadFile, writeFile as fsWriteFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  type Connection,
  addConnection,
  removeConnection as removeConnectionFromList,
  connectionsToFile,
  connectionsFromFile,
  trackerConnection,
  setRole,
} from "../../lib/mcp/connections";
import { materialize, serializeConfig } from "../../lib/mcp/materialize";
import { mergeGitignore } from "../../lib/mcp/gitignore";

const KEYCHAIN_SERVICE = "dev.cadre.ide";

// ---------------------------------------------------------------------------
// Injectable I/O
// ---------------------------------------------------------------------------

export interface NodeIo {
  getSecret(key: string): Promise<string | null>;
  setSecret(key: string, value: string): Promise<void>;
  deleteSecret(key: string): Promise<void>;
  /** null on ENOENT (or any other read failure — the caller only needs "absent"). */
  readFile(path: string): Promise<string | null>;
  /** mkdir -p the parent dir first. */
  writeFile(path: string, content: string): Promise<void>;
}

/** Real keychain (macOS `security`) + real fs. Mirrors `src/cli/planning.ts getPlanningKey`. */
export function realNodeIo(): NodeIo {
  return {
    getSecret(key: string): Promise<string | null> {
      return new Promise((resolve) => {
        execFile(
          "security",
          ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", key, "-w"],
          (err, stdout) => {
            if (err) {
              resolve(null);
              return;
            }
            const value = String(stdout).trim();
            resolve(value.length > 0 ? value : null);
          }
        );
      });
    },
    setSecret(key: string, value: string): Promise<void> {
      return new Promise((resolve, reject) => {
        execFile(
          "security",
          ["add-generic-password", "-U", "-s", KEYCHAIN_SERVICE, "-a", key, "-w", value],
          (err) => {
            if (err) {
              reject(err);
              return;
            }
            resolve();
          }
        );
      });
    },
    deleteSecret(key: string): Promise<void> {
      return new Promise((resolve) => {
        // Ignore not-found / any nonzero exit — deleting an already-absent
        // secret is a no-op, not an error.
        execFile("security", ["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", key], () => {
          resolve();
        });
      });
    },
    async readFile(path: string): Promise<string | null> {
      try {
        return await fsReadFile(path, "utf8");
      } catch {
        return null;
      }
    },
    async writeFile(path: string, content: string): Promise<void> {
      await mkdir(dirname(path), { recursive: true });
      await fsWriteFile(path, content, "utf8");
    },
  };
}

// ---------------------------------------------------------------------------
// Paths (must match connectionsStore.ts exactly)
// ---------------------------------------------------------------------------

const mcpJsonPath = (root: string) => `${root}/.cadre/mcp.json`;
const fleetJsonPath = (root: string) => `${root}/.cadre/fleet.mcp.json`;
const trackerJsonPath = (root: string) => `${root}/.cadre/tracker.mcp.json`;
const gitignorePath = (root: string) => `${root}/.gitignore`;

/** Append any of `lines` not already present (exact-line match) to the gitignore
 *  at `path`, creating it if absent. No-op if all lines are already present. */
async function appendIfMissing(io: NodeIo, path: string, lines: string[]): Promise<void> {
  const existing = (await io.readFile(path)) ?? "";
  const { content, changed } = mergeGitignore(existing, lines);
  if (!changed) return;
  await io.writeFile(path, content);
}

// ---------------------------------------------------------------------------
// Registry read/write (.cadre/mcp.json)
// ---------------------------------------------------------------------------

/** Read `.cadre/mcp.json`; missing/malformed → []. Never throws. */
export async function readConnections(io: NodeIo, root: string): Promise<Connection[]> {
  const raw = await io.readFile(mcpJsonPath(root));
  if (raw === null) return [];
  return connectionsFromFile(raw);
}

/** Write `.cadre/mcp.json` (refs only — never secret values). Byte-identical
 *  to what the desktop store's `save()` writes for the same list. */
export async function writeConnections(io: NodeIo, root: string, list: Connection[]): Promise<void> {
  await io.writeFile(mcpJsonPath(root), connectionsToFile(list));
}

// ---------------------------------------------------------------------------
// Fleet materialization (.cadre/fleet.mcp.json) — ${VAR} placeholders,
// enabled-filtered (NOT secret-resolution-filtered; that's resolve*'s job).
// ---------------------------------------------------------------------------

/** Write `.cadre/fleet.mcp.json` from the current registry and gitignore-guard
 *  both mcp files. Byte-identical to the desktop store's `materializeFleet`. */
export async function materializeFleetNode(io: NodeIo, root: string): Promise<void> {
  const list = await readConnections(io, root);
  const m = materialize(list);
  await io.writeFile(fleetJsonPath(root), serializeConfig(m));
  await appendIfMissing(io, gitignorePath(root), [".cadre/fleet.mcp.json", ".cadre/mcp.json"]);
}

// ---------------------------------------------------------------------------
// Mutators
// ---------------------------------------------------------------------------

/** Stage secrets to the keychain, upsert the connection, persist, and
 *  re-materialize the fleet config. */
export async function upsertConnection(
  io: NodeIo,
  root: string,
  conn: Connection,
  secrets: Record<string, string>
): Promise<void> {
  for (const ref of conn.secretRefs) {
    const value = secrets[ref.field];
    if (value !== undefined) {
      await io.setSecret(ref.keychainKey, value);
    }
  }
  const list = addConnection(await readConnections(io, root), conn);
  await writeConnections(io, root, list);
  await materializeFleetNode(io, root);
}

/** Delete the connection's keychain secrets, remove it, persist, and re-materialize. */
export async function removeConnection(io: NodeIo, root: string, id: string): Promise<void> {
  const list = await readConnections(io, root);
  const conn = list.find((c) => c.id === id);
  if (conn) {
    for (const ref of conn.secretRefs) {
      await io.deleteSecret(ref.keychainKey);
    }
  }
  const next = removeConnectionFromList(list, id);
  await writeConnections(io, root, next);
  await materializeFleetNode(io, root);
}

/** Set (or clear) the single connection designated as the tracker, then persist. */
export async function setRoleNode(
  io: NodeIo,
  root: string,
  id: string,
  role: "tracker" | undefined
): Promise<void> {
  const list = await readConnections(io, root);
  const next = setRole(list, id, role);
  await writeConnections(io, root, next);
}

// ---------------------------------------------------------------------------
// Survivors-only secret resolution (resolveTrackerEnvNode)
// ---------------------------------------------------------------------------

/** Shared body for resolve*Env: resolve each connection's secrets
 *  survivors-only from the keychain (ALL of a connection's secretRefs must
 *  resolve or the whole connection is dropped — a single missing secret must
 *  never leave an unresolvable ${VAR} in the written file), materialize+write
 *  the filtered config from ONLY the survivors (even if empty, to clear stale
 *  content), and gitignore-guard it. */
async function resolveEnvAndWrite(
  io: NodeIo,
  connections: Connection[],
  configPath: string,
  gitignoreFilePath: string,
  gitignoreLines: string[]
): Promise<{ env: Record<string, string> } | null> {
  const survivors: Connection[] = [];
  const env: Record<string, string> = {};
  for (const conn of connections) {
    const resolved: Record<string, string> = {};
    let ok = true;
    for (const ref of conn.secretRefs) {
      const value = await io.getSecret(ref.keychainKey);
      if (value === null) {
        ok = false;
        break;
      }
      resolved[ref.field] = value;
    }
    if (!ok) continue;
    survivors.push(conn);
    Object.assign(env, resolved);
  }

  const m = materialize(survivors);
  await io.writeFile(configPath, serializeConfig(m));
  await appendIfMissing(io, gitignoreFilePath, gitignoreLines);

  if (survivors.length === 0) return null;
  return { env };
}

/** Resolve the designated tracker connection's required secrets from the
 *  keychain and write a ONE-connection `.cadre/tracker.mcp.json`. Returns
 *  null (no write) when there's no connection designated as the tracker;
 *  returns null (config still written, cleared) when its secrets don't
 *  resolve. */
export async function resolveTrackerEnvNode(
  io: NodeIo,
  root: string
): Promise<{ mcpConfigPath: string; env: Record<string, string>; serverKey: string } | null> {
  const list = await readConnections(io, root);
  const conn = trackerConnection(list);
  if (!conn) return null;

  const path = trackerJsonPath(root);
  const result = await resolveEnvAndWrite(io, [conn], path, gitignorePath(root), [".cadre/tracker.mcp.json"]);
  if (!result) return null;
  return { mcpConfigPath: path, env: result.env, serverKey: conn.id };
}
