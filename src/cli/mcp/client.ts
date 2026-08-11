/**
 * Node MCP client — the real `@modelcontextprotocol/sdk` client both faces
 * (desktop Tauri command + `cadre mcp probe` CLI entry) reuse to talk to a
 * user-configured `Connection` (Task 1, `src/lib/mcp/connections.ts`).
 *
 * Node-only: no zustand/React/Tauri import, mirroring `src/cli/nodeDeps.ts` so
 * this module compiles cleanly under `tsconfig.cli.json` (CommonJS) and stays
 * usable from a plain Node process with no browser graph attached.
 *
 * SDK version pinned: @modelcontextprotocol/sdk@1.30.0. That version's
 * `package.json` "exports" has no per-subpath entries for `./client/stdio` etc.
 * (only exact `./client` and `./server`, plus a `"./*"` wildcard mapping to
 * `dist/cjs/*` under `require`) — so subpath imports MUST include the literal
 * `.js` extension (`@modelcontextprotocol/sdk/client/stdio.js`) to match the
 * wildcard target file exactly; the extension-less form does not resolve.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport as SdkTransport } from "@modelcontextprotocol/sdk/shared/transport.js";

import type { Connection } from "../../lib/mcp/connections";

export interface McpProbe {
  ok: boolean;
  toolCount: number;
  toolNames: string[];
  error?: string;
}

export interface McpToolSummary {
  name: string;
  description?: string;
}

export interface McpSession {
  listTools: () => Promise<McpToolSummary[]>;
  callTool: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
  close: () => Promise<void>;
}

export type SecretResolver = (keychainKey: string) => Promise<string | null>;

const DEFAULT_TIMEOUT_MS = 15000;
const CLOSE_TIMEOUT_MS = 3000;
const CLIENT_INFO = { name: "cadre", version: "1.0.0" };

/** Resolve every `secretRefs` entry through `resolveSecret`, split by target. */
async function resolveSecrets(
  conn: Connection,
  resolveSecret: SecretResolver
): Promise<{ env: Record<string, string>; headers: Record<string, string> }> {
  const env: Record<string, string> = {};
  const headers: Record<string, string> = {};
  for (const ref of conn.secretRefs) {
    const value = await resolveSecret(ref.keychainKey);
    if (value == null) continue;
    if (ref.target === "env") env[ref.field] = value;
    else headers[ref.field] = value;
  }
  return { env, headers };
}

/** Build the SDK transport for `conn`, merging resolved secrets into env/headers. */
function buildTransport(
  conn: Connection,
  env: Record<string, string>,
  headers: Record<string, string>
): SdkTransport {
  if (conn.transport.kind === "stdio") {
    return new StdioClientTransport({
      command: conn.transport.command,
      args: conn.transport.args,
      env: { ...conn.transport.env, ...env },
    });
  }
  return new StreamableHTTPClientTransport(new URL(conn.transport.url), {
    requestInit: { headers: { ...conn.transport.headers, ...headers } },
  });
}

/** Race `promise` against a timeout; the timer is unref'd so it never keeps the process alive. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    if (typeof timer.unref === "function") timer.unref();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * Connect to `conn`, initialize, list its tools, and close — all wrapped in a
 * single `timeoutMs` budget (default 15s). Never throws and never hangs past
 * the budget: a hung/misbehaving/nonexistent server yields `{ ok: false,
 * error }` instead.
 */
export async function probeConnection(
  conn: Connection,
  resolveSecret: SecretResolver,
  opts?: { timeoutMs?: number }
): Promise<McpProbe> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let client: Client | undefined;
  try {
    const { env, headers } = await resolveSecrets(conn, resolveSecret);
    const transport = buildTransport(conn, env, headers);
    client = new Client(CLIENT_INFO, { capabilities: {} });
    const activeClient = client;
    const toolNames = await withTimeout(
      (async () => {
        await activeClient.connect(transport);
        const result = await activeClient.listTools();
        return result.tools.map((tool) => tool.name);
      })(),
      timeoutMs,
      `MCP probe timed out after ${timeoutMs}ms`
    );
    return { ok: true, toolCount: toolNames.length, toolNames };
  } catch (e) {
    return { ok: false, toolCount: 0, toolNames: [], error: e instanceof Error ? e.message : String(e) };
  } finally {
    if (client) {
      try {
        await withTimeout(client.close(), CLOSE_TIMEOUT_MS, "MCP client close timed out");
      } catch {
        // best-effort — the process/transport may already be gone
      }
    }
  }
}

/**
 * Open a live session against `conn` for later slices (tool listing + calls
 * outside of the one-shot probe). Callers own the returned handle and MUST
 * call `close()` when done; this function does not itself apply a timeout.
 */
export async function openSession(conn: Connection, resolveSecret: SecretResolver): Promise<McpSession> {
  const { env, headers } = await resolveSecrets(conn, resolveSecret);
  const transport = buildTransport(conn, env, headers);
  const client = new Client(CLIENT_INFO, { capabilities: {} });
  await client.connect(transport);
  return {
    listTools: async () => {
      const result = await client.listTools();
      return result.tools.map((tool) => ({ name: tool.name, description: tool.description }));
    },
    callTool: async (name, args) => client.callTool({ name, arguments: args ?? {} }),
    close: async () => {
      await client.close();
    },
  };
}
