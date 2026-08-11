/**
 * `cadre mcp probe` entry point: reads a single `Connection` (Task 1 shape) as
 * JSON on stdin, probes it with the real MCP client, and writes the resulting
 * `McpProbe` as JSON on stdout. Exits 0 even on probe failure — `ok:false` in
 * the JSON is the failure signal, not the process exit code, so the desktop
 * side (which shells out to this entry) never has to special-case a nonzero
 * exit for an ordinary "server didn't respond" case.
 *
 * Secrets are resolved from the macOS keychain the same way
 * `src/cli/planning.ts` (`getPlanningKey`) resolves the Anthropic key: shell
 * `security find-generic-password -s dev.cadre.ide -a <keychainKey> -w`,
 * `null` on any non-zero exit. Secret VALUES are never written to stdout/stderr
 * — only the `McpProbe` result (tool names/counts/ok/error) is printed.
 */

import { execFile } from "node:child_process";

import { probeConnection } from "./client";
import type { Connection } from "../../lib/mcp/connections";

const KEYCHAIN_SERVICE = "dev.cadre.ide";

/** Resolve one secret from the macOS keychain; `null` on any failure (never throws). */
function resolveKeychainSecret(keychainKey: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", keychainKey, "-w"],
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
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

async function main(): Promise<void> {
  const raw = await readStdin();
  const conn = JSON.parse(raw) as Connection;
  const result = await probeConnection(conn, resolveKeychainSecret);
  process.stdout.write(JSON.stringify(result));
  process.exit(0);
}

main().catch((err) => {
  // Malformed stdin (bad JSON) or another pre-probe failure: still emit an
  // McpProbe-shaped JSON payload so the caller has one parse path, never a
  // secret value.
  const message = err instanceof Error ? err.message : String(err);
  process.stdout.write(JSON.stringify({ ok: false, toolCount: 0, toolNames: [], error: message }));
  process.exit(0);
});
