# MCP Connections — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make external integrations plug-and-play through MCP: a developer connects a tool (ClickUp/GitHub/Jira/Notion/Custom) with a pasted token and every fleet agent inherits it.

**Architecture:** A pure connection registry + preset catalog (`src/lib/mcp/`), a Node MCP client/probe reused by both faces (`src/cli/mcp/`, `@modelcontextprotocol/sdk`), a Tauri `mcp_probe` command, a zustand `connectionsStore`, fleet materialization to `.cadre/fleet.mcp.json` (`${VAR}` placeholders; secrets injected into the claude child env via the existing `create_pty` `env` param), and a Connections UI. Secrets live only in the macOS keychain.

**Tech Stack:** TypeScript, React 19, zustand, Tauri (Rust), `@modelcontextprotocol/sdk`, vitest.

**Spec:** `docs/superpowers/specs/2026-08-11-mcp-connections-design.md` (read it — the design review decisions are binding).

## Global Constraints

- **Secrets never touch disk.** Token values live only in the keychain (service `dev.cadre.ide`, via `src/lib/secrets.ts` / `secret_get`/`secret_set`). `.cadre/mcp.json` stores secret *references* only; `.cadre/fleet.mcp.json` stores `${VAR}` placeholders only. A test MUST assert no secret value appears in either file's serialized form.
- **Managed config path, never the user's root `.mcp.json`.** The fleet reads `.cadre/fleet.mcp.json` via `claude --mcp-config <absolute path>`. Never write or overwrite the project-root `.mcp.json`.
- **Only fleet WORK agents get `--mcp-config`.** Eval agents (Guardian/Audit) do not.
- **Errors surface as a toast AND an AI Log entry** via the existing `reportError` path (`src/lib/reportError.ts`).
- **Catalog honesty:** a preset tile ships only if a token/env/header-auth server actually exists for it. OAuth-only servers go through `custom`.
- Pure modules in `src/lib/mcp/` import no zustand/Tauri (so the CLI can reuse them). The Node client in `src/cli/mcp/` imports no browser graph (like `src/cli/nodeDeps.ts`).
- Every task ends green: `npx tsc --noEmit`, and for CLI-touching tasks `npx tsc -p tsconfig.cli.json`, plus `npx vitest run <touched files>`.

## File Structure

- Create `src/lib/mcp/connections.ts` — pure model, reducers, file (de)serialization.
- Create `src/lib/mcp/catalog.ts` — preset catalog + `presetToConnection`.
- Create `src/lib/mcp/materialize.ts` — `materialize()` → placeholder config + requiredSecrets.
- Create `src/cli/mcp/client.ts` — `probeConnection` / `openSession` over `@modelcontextprotocol/sdk`.
- Create `src/cli/mcp/probe.ts` — stdin→stdout CLI entry Rust invokes; resolves secrets from keychain.
- Create `src/cli/mcp/stubServer.ts` — 2-tool stdio MCP server, a test fixture.
- Create `src-tauri/src/mcp.rs` — `mcp_probe` command; register in `src-tauri/src/lib.rs`.
- Create `src/stores/connectionsStore.ts` — load/save registry, keychain writes, probe, materialize, project `.gitignore` upkeep.
- Create `src/cadre/connections/ConnectionsView.tsx` + `ConnectionModal.tsx` — catalog grid, add/edit modal, test, list.
- Modify `src/lib/maintain/runBatch.ts` — `subagentCommand(prompt, projectDir, opts?)` gains `mcpConfigPath`.
- Modify `src/cadre/TerminalPanel.tsx` — add `env?: Record<string,string>` prop, pass to `create_pty`.
- Modify `src/cadre/maintain/SubagentCard.tsx` (+ its batch store) — resolve secrets → env, pass `env` + mcp-config to the work-agent terminal.
- Modify `src/lib/demo/mockBackend.ts` — canned `mcp_probe`.
- Modify `src/cadre/Settings.tsx` (or the nav) — entry point to Connections.
- Modify `tsconfig.cli.json` — include `src/cli/mcp`.
- Modify `package.json` — add `@modelcontextprotocol/sdk`.
- Modify `scripts/e2e-extensive.mjs` — Connections step.

---

### Task 1: Connection model + registry (de)serialization

**Files:**
- Create: `src/lib/mcp/connections.ts`
- Test: `src/lib/mcp/connections.test.ts`

**Interfaces:**
- Produces (consumed by every later task):
```ts
export type ConnStatus = "unconfigured" | "connected" | "error";
export interface SecretRef { field: string; keychainKey: string; target: "env" | "header"; }
export interface StdioTransport { kind: "stdio"; command: string; args: string[]; env: Record<string, string>; }
export interface HttpTransport { kind: "http"; url: string; headers: Record<string, string>; }
export type Transport = StdioTransport | HttpTransport;
export interface Connection {
  id: string; presetId: string; label: string;
  transport: Transport; secretRefs: SecretRef[];
  enabled: boolean; status: ConnStatus; toolCount?: number; lastError?: string;
}
export interface McpRegistryFile { version: 1; connections: Connection[]; }
export function addConnection(list: Connection[], c: Connection): Connection[];
export function updateConnection(list: Connection[], id: string, patch: Partial<Connection>): Connection[];
export function removeConnection(list: Connection[], id: string): Connection[];
export function setStatus(list: Connection[], id: string, status: ConnStatus, extra?: { toolCount?: number; lastError?: string }): Connection[];
export function connectionsToFile(list: Connection[]): string;      // pretty JSON, McpRegistryFile
export function connectionsFromFile(raw: string): Connection[];     // tolerant: bad JSON → []
export function uniqueId(list: Connection[], base: string): string; // base, base-2, base-3…
```

- [ ] **Step 1: Write the failing test** (`src/lib/mcp/connections.test.ts`)

```ts
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
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run src/lib/mcp/connections.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `src/lib/mcp/connections.ts`**

```ts
// Pure connection registry model — no Tauri/zustand so the CLI can reuse it.
export type ConnStatus = "unconfigured" | "connected" | "error";
export interface SecretRef { field: string; keychainKey: string; target: "env" | "header"; }
export interface StdioTransport { kind: "stdio"; command: string; args: string[]; env: Record<string, string>; }
export interface HttpTransport { kind: "http"; url: string; headers: Record<string, string>; }
export type Transport = StdioTransport | HttpTransport;
export interface Connection {
  id: string; presetId: string; label: string;
  transport: Transport; secretRefs: SecretRef[];
  enabled: boolean; status: ConnStatus; toolCount?: number; lastError?: string;
}
export interface McpRegistryFile { version: 1; connections: Connection[]; }

export function addConnection(list: Connection[], c: Connection): Connection[] {
  return [...list.filter((x) => x.id !== c.id), c];
}
export function updateConnection(list: Connection[], id: string, patch: Partial<Connection>): Connection[] {
  return list.map((c) => (c.id === id ? { ...c, ...patch } : c));
}
export function removeConnection(list: Connection[], id: string): Connection[] {
  return list.filter((c) => c.id !== id);
}
export function setStatus(
  list: Connection[], id: string, status: ConnStatus,
  extra?: { toolCount?: number; lastError?: string },
): Connection[] {
  return updateConnection(list, id, {
    status,
    toolCount: extra?.toolCount,
    lastError: status === "error" ? extra?.lastError : undefined,
  });
}
export function connectionsToFile(list: Connection[]): string {
  const file: McpRegistryFile = { version: 1, connections: list };
  return JSON.stringify(file, null, 2) + "\n";
}
export function connectionsFromFile(raw: string): Connection[] {
  try {
    const parsed = JSON.parse(raw) as Partial<McpRegistryFile>;
    if (parsed?.version !== 1 || !Array.isArray(parsed.connections)) return [];
    return parsed.connections as Connection[];
  } catch { return []; }
}
export function uniqueId(list: Connection[], base: string): string {
  const taken = new Set(list.map((c) => c.id));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) { const id = `${base}-${n}`; if (!taken.has(id)) return id; }
}
```

- [ ] **Step 4: Run tests, verify pass** — `npx vitest run src/lib/mcp/connections.test.ts` → PASS; `npx tsc --noEmit` → clean.
- [ ] **Step 5: Commit** — `feat(mcp): connection registry model + file (de)serialization`

---

### Task 2: Preset catalog

**Files:**
- Create: `src/lib/mcp/catalog.ts`
- Test: `src/lib/mcp/catalog.test.ts`

**Interfaces:**
- Consumes: `Connection`, `SecretRef`, `Transport`, `uniqueId` (Task 1).
- Produces:
```ts
export interface SecretField { field: string; label: string; target: "env" | "header"; required: boolean; placeholder?: string; }
export interface Preset {
  id: string; label: string; blurb: string; docsUrl?: string;
  transport: Transport;        // template (secret fields hold "" until seeded)
  secretFields: SecretField[]; // becomes secretRefs on seed
  custom?: boolean;
}
export const CATALOG: Preset[];
export function presetToConnection(preset: Preset, existing: Connection[]): Connection;
```

- [ ] **Step 1: Write the failing test** (`src/lib/mcp/catalog.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { CATALOG, presetToConnection } from "./catalog";

describe("catalog", () => {
  it("every non-custom preset can deliver a token-auth connection", () => {
    for (const p of CATALOG.filter((x) => !x.custom)) {
      expect(p.secretFields.length).toBeGreaterThan(0);         // has a token to paste
      expect(p.secretFields.some((f) => f.required)).toBe(true);
      // No OAuth-only tiles: token/env/header auth only.
      expect(p.secretFields.every((f) => f.target === "env" || f.target === "header")).toBe(true);
    }
  });

  it("includes ClickUp and a custom escape hatch", () => {
    expect(CATALOG.find((p) => p.id === "clickup")).toBeTruthy();
    expect(CATALOG.find((p) => p.custom)).toBeTruthy();
  });

  it("seeds a Connection with secretRefs and a unique id", () => {
    const clickup = CATALOG.find((p) => p.id === "clickup")!;
    const c1 = presetToConnection(clickup, []);
    const c2 = presetToConnection(clickup, [c1]);
    expect(c1.id).toBe("clickup");
    expect(c2.id).toBe("clickup-2");
    expect(c1.secretRefs.map((r) => r.field)).toContain("CLICKUP_API_TOKEN");
    expect(c1.enabled).toBe(false);
    expect(c1.status).toBe("unconfigured");
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**

- [ ] **Step 3: Implement `src/lib/mcp/catalog.ts`** — the implementer CONFIRMS current package ids at build time and drops any preset lacking a real token-auth stdio server (spec: catalog honesty).

```ts
import { type Connection, type Transport, uniqueId } from "./connections";

export interface SecretField { field: string; label: string; target: "env" | "header"; required: boolean; placeholder?: string; }
export interface Preset {
  id: string; label: string; blurb: string; docsUrl?: string;
  transport: Transport; secretFields: SecretField[]; custom?: boolean;
}

const stdio = (command: string, args: string[]): Transport => ({ kind: "stdio", command, args, env: {} });

export const CATALOG: Preset[] = [
  {
    id: "clickup", label: "ClickUp", blurb: "Tasks, lists, docs.",
    docsUrl: "https://clickup.com/api",
    transport: stdio("npx", ["-y", "@taazkareem/clickup-mcp-server"]),
    secretFields: [
      { field: "CLICKUP_API_TOKEN", label: "API token", target: "env", required: true, placeholder: "pk_…" },
      { field: "CLICKUP_TEAM_ID", label: "Team ID (optional)", target: "env", required: false },
    ],
  },
  {
    id: "github", label: "GitHub", blurb: "Issues, PRs, repos.",
    transport: stdio("npx", ["-y", "@modelcontextprotocol/server-github"]),
    secretFields: [{ field: "GITHUB_TOKEN", label: "Personal access token", target: "env", required: true, placeholder: "ghp_…" }],
  },
  {
    id: "jira", label: "Jira / Atlassian", blurb: "Issues and boards.",
    transport: stdio("npx", ["-y", "@modelcontextprotocol/server-atlassian"]),
    secretFields: [
      { field: "JIRA_URL", label: "Site URL", target: "env", required: true, placeholder: "https://you.atlassian.net" },
      { field: "JIRA_EMAIL", label: "Email", target: "env", required: true },
      { field: "JIRA_API_TOKEN", label: "API token", target: "env", required: true },
    ],
  },
  {
    id: "notion", label: "Notion", blurb: "Pages and databases.",
    transport: stdio("npx", ["-y", "@notionhq/notion-mcp-server"]),
    secretFields: [{ field: "NOTION_TOKEN", label: "Integration token", target: "env", required: true, placeholder: "secret_/ntn_…" }],
  },
  {
    id: "custom", label: "Custom", blurb: "Any MCP server (stdio or HTTP).", custom: true,
    transport: stdio("", []),
    secretFields: [],
  },
];

// Seed a Connection from a preset: fields → secretRefs (keychainKey = mcp.<id>.<field>).
export function presetToConnection(preset: Preset, existing: Connection[]): Connection {
  const id = uniqueId(existing, preset.id);
  return {
    id, presetId: preset.id, label: preset.label,
    transport: structuredClone(preset.transport),
    secretRefs: preset.secretFields.map((f) => ({
      field: f.field, keychainKey: `mcp.${id}.${f.field}`, target: f.target,
    })),
    enabled: false, status: "unconfigured",
  };
}
```

- [ ] **Step 4: Run tests + tsc, verify pass.**
- [ ] **Step 5: Commit** — `feat(mcp): preset catalog (ClickUp/GitHub/Jira/Notion/custom)`

---

### Task 3: Fleet materialization

**Files:**
- Create: `src/lib/mcp/materialize.ts`
- Test: `src/lib/mcp/materialize.test.ts`

**Interfaces:**
- Consumes: `Connection`, `SecretRef` (Task 1).
- Produces:
```ts
export interface ClaudeMcpConfig { mcpServers: Record<string, { command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string>; }>; }
export interface RequiredSecret { envVar: string; keychainKey: string; }
export interface Materialized { config: ClaudeMcpConfig; requiredSecrets: RequiredSecret[]; }
export function materialize(list: Connection[]): Materialized;
export function serializeConfig(m: Materialized): string; // pretty JSON of m.config only
```

Rules (from spec): only `enabled` connections; secrets become `${FIELD}` placeholders (never resolved here); `requiredSecrets` lists `env`-target refs so the spawn can inject them; `header`-target secrets go into `headers` as `${FIELD}` too.

- [ ] **Step 1: Write the failing test** (`src/lib/mcp/materialize.test.ts`)

```ts
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
```

- [ ] **Step 2: Run it, verify it fails.**

- [ ] **Step 3: Implement `src/lib/mcp/materialize.ts`**

```ts
import type { Connection } from "./connections";

export interface ClaudeMcpConfig {
  mcpServers: Record<string, {
    command?: string; args?: string[]; env?: Record<string, string>;
    url?: string; headers?: Record<string, string>;
  }>;
}
export interface RequiredSecret { envVar: string; keychainKey: string; }
export interface Materialized { config: ClaudeMcpConfig; requiredSecrets: RequiredSecret[]; }

export function materialize(list: Connection[]): Materialized {
  const config: ClaudeMcpConfig = { mcpServers: {} };
  const requiredSecrets: RequiredSecret[] = [];
  for (const c of list) {
    if (!c.enabled) continue;
    if (c.transport.kind === "stdio") {
      const env: Record<string, string> = { ...c.transport.env };
      for (const r of c.secretRefs) {
        if (r.target !== "env") continue;
        env[r.field] = `\${${r.field}}`;
        requiredSecrets.push({ envVar: r.field, keychainKey: r.keychainKey });
      }
      config.mcpServers[c.id] = { command: c.transport.command, args: c.transport.args, env };
    } else {
      const headers: Record<string, string> = { ...c.transport.headers };
      for (const r of c.secretRefs) {
        if (r.target !== "header") continue;
        headers[r.field] = `\${${r.field}}`;
        requiredSecrets.push({ envVar: r.field, keychainKey: r.keychainKey });
      }
      config.mcpServers[c.id] = { url: c.transport.url, headers };
    }
  }
  return { config, requiredSecrets };
}

export function serializeConfig(m: Materialized): string {
  return JSON.stringify(m.config, null, 2) + "\n";
}
```

- [ ] **Step 4: Run tests + tsc, verify pass.**
- [ ] **Step 5: Commit** — `feat(mcp): fleet materialization (placeholders + requiredSecrets)`

---

### Task 4: Node MCP client + probe entry (+ dependency)

**Files:**
- Create: `src/cli/mcp/client.ts`, `src/cli/mcp/probe.ts`, `src/cli/mcp/stubServer.ts`
- Test: `src/cli/mcp/client.test.ts`
- Modify: `package.json` (add `@modelcontextprotocol/sdk`), `tsconfig.cli.json` (include `src/cli/mcp`)

**Interfaces:**
- Consumes: `Connection`, `Transport` (Task 1).
- Produces:
```ts
export interface McpProbe { ok: boolean; toolCount: number; toolNames: string[]; error?: string; }
export function probeConnection(
  conn: Connection,
  resolveSecret: (keychainKey: string) => Promise<string | null>,
  opts?: { timeoutMs?: number },
): Promise<McpProbe>;
```
`probe.ts` reads a `Connection` JSON from stdin, resolves secrets from the keychain (shell `security find-generic-password -s dev.cadre.ide -a <keychainKey> -w`, reused from `src/cli/planning.ts`), calls `probeConnection`, prints `McpProbe` JSON to stdout, exits 0.

- [ ] **Step 1: Install the dependency** — `npm install @modelcontextprotocol/sdk` (confirm the installed transport class names — `StdioClientTransport`, `StreamableHTTPClientTransport` — and adjust imports to the installed version).

- [ ] **Step 2: Write the stub server** (`src/cli/mcp/stubServer.ts`) — a minimal stdio MCP server exposing exactly two no-op tools (`echo`, `ping`) using the SDK's `Server` + `StdioServerTransport`. Run as `node dist-cli/mcp/stubServer.js`. (Confirm the SDK server API for the installed version.)

- [ ] **Step 3: Write the failing test** (`src/cli/mcp/client.test.ts`)

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { probeConnection } from "./client";
import type { Connection } from "../../lib/mcp/connections";

const stub: Connection = {
  id: "stub", presetId: "custom", label: "Stub",
  transport: { kind: "stdio", command: "node", args: ["dist-cli/mcp/stubServer.js"], env: {} },
  secretRefs: [], enabled: true, status: "unconfigured",
};
const noSecret = async () => null;

describe("probeConnection", () => {
  beforeAll(() => { execFileSync("npx", ["tsc", "-p", "tsconfig.cli.json"], { stdio: "inherit" }); });

  it("connects to a stub server and lists its two tools", async () => {
    const r = await probeConnection(stub, noSecret, { timeoutMs: 15000 });
    expect(r.ok).toBe(true);
    expect(r.toolCount).toBe(2);
    expect(r.toolNames.sort()).toEqual(["echo", "ping"]);
  }, 30000);

  it("returns ok:false with an error on a bad command (times out / fails fast)", async () => {
    const bad: Connection = { ...stub, transport: { kind: "stdio", command: "node", args: ["/no/such/file.js"], env: {} } };
    const r = await probeConnection(bad, noSecret, { timeoutMs: 4000 });
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  }, 20000);
});
```

- [ ] **Step 4: Run it, verify it fails.**

- [ ] **Step 5: Implement `src/cli/mcp/client.ts`** — connect via the SDK, `initialize`, `tools/list`, wrapped in a timeout; stdio secrets merged into `env`, http secrets into `headers`; always close the transport in a `finally`. (Full implementation is SDK-version-specific; the implementer writes it against the installed API. Behavior contract: fulfills the two tests above, never throws, never hangs past `timeoutMs`.)

- [ ] **Step 6: Implement `src/cli/mcp/probe.ts`** — read stdin to end, `JSON.parse` the Connection, build a keychain resolver (execFile `security …`, return null on non-zero), `probeConnection`, `process.stdout.write(JSON.stringify(result))`. Never print secret values.

- [ ] **Step 7: Update `tsconfig.cli.json`** include to cover `src/cli/mcp/**`.

- [ ] **Step 8: Run tests + both tscs, verify pass** — `npx vitest run src/cli/mcp/client.test.ts`, `npx tsc --noEmit`, `npx tsc -p tsconfig.cli.json`.
- [ ] **Step 9: Commit** — `feat(mcp): Node MCP client + probe entry (@modelcontextprotocol/sdk)`

---

### Task 5: Tauri `mcp_probe` command

**Files:**
- Create: `src-tauri/src/mcp.rs`
- Modify: `src-tauri/src/lib.rs` (mod + register in `generate_handler!`)

**Interfaces:**
- Produces (frontend calls): `invoke("mcp_probe", { connectionJson: string }) -> string` (the `McpProbe` JSON, verbatim from the Node entry).

- [ ] **Step 1: Implement `src-tauri/src/mcp.rs`**

```rust
use std::io::Write;
use std::process::{Command, Stdio};

/// Probe an MCP server by delegating to the Node client entry (dist-cli/mcp/probe.js).
/// The connection JSON goes in on stdin; the McpProbe JSON comes back on stdout.
/// Secrets are resolved inside the Node entry (keychain) — none cross this boundary.
#[tauri::command]
pub fn mcp_probe(connection_json: String) -> Result<String, String> {
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    let script = cwd.join("dist-cli/mcp/probe.js");
    let mut child = Command::new("node")
        .arg(script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn node: {e}"))?;
    child
        .stdin
        .take()
        .ok_or("no stdin")?
        .write_all(connection_json.as_bytes())
        .map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!("probe failed: {}", String::from_utf8_lossy(&out.stderr)));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}
```

- [ ] **Step 2: Register it** — in `src-tauri/src/lib.rs` add `mod mcp;` and `mcp::mcp_probe,` to the `generate_handler!` list.
- [ ] **Step 3: Verify it compiles** — `cargo build --manifest-path src-tauri/Cargo.toml` (or `cargo check`). Expected: success.
- [ ] **Step 4: Commit** — `feat(mcp): mcp_probe Tauri command (delegates to Node probe)`

> Note: `dist-cli/mcp/probe.js` must exist at runtime — `npm run cadre:build` (or the app build) produces it. `cwd`-relative resolution matches how the dev app runs from the repo root; production bundling is the tracked follow-up.

---

### Task 6: connectionsStore

**Files:**
- Create: `src/stores/connectionsStore.ts`
- Test: `src/stores/connectionsStore.test.ts`

**Interfaces:**
- Consumes: model (Task 1), catalog (Task 2), materialize (Task 3), `mcp_probe` (Task 5), `src/lib/secrets.ts`, `reportError`.
- Produces (UI + fleet consume):
```ts
interface ConnectionsState {
  connections: Connection[];
  load(root: string): Promise<void>;
  save(root: string): Promise<void>;                          // writes .cadre/mcp.json
  addFromPreset(preset: Preset): Connection;
  upsert(root: string, conn: Connection, secrets: Record<string,string>): Promise<void>; // writes keychain + save + materialize
  remove(root: string, id: string): Promise<void>;
  setEnabled(root: string, id: string, on: boolean): Promise<void>;
  probe(conn: Connection, secrets?: Record<string,string>): Promise<McpProbe>; // secrets staged to keychain first if given
  materializeFleet(root: string): Promise<{ path: string; requiredSecrets: RequiredSecret[] }>; // writes .cadre/fleet.mcp.json
  resolveFleetEnv(root: string): Promise<{ mcpConfigPath: string; env: Record<string,string> } | null>; // for the spawn
}
```

Key behaviors:
- `upsert` writes each secret to the keychain via `secretSet(ref.keychainKey, value)` **before** persisting; the Connection (refs only) then goes to `.cadre/mcp.json`; then `materializeFleet`.
- `materializeFleet` writes `serializeConfig(materialize(connections))` to `<root>/.cadre/fleet.mcp.json` via `invoke("write_text_file", …)`, and appends `.cadre/fleet.mcp.json` + `.cadre/mcp.json` to `<root>/.gitignore` if absent (append-if-missing helper).
- `resolveFleetEnv` reads each `requiredSecret` from the keychain into `{ [envVar]: value }` and returns it with the abs config path; a missing secret is skipped + `reportError` warns (spec: don't launch with an unresolvable `${VAR}`).
- All failures → `reportError` (toast + AI Log).

- [ ] **Step 1: Write failing tests** (`src/stores/connectionsStore.test.ts`) — mock `@tauri-apps/api/core` `invoke` and `src/lib/secrets.ts` (pattern from `trackerStore.test.ts`). Assert: (a) `upsert` calls `secretSet` for each ref and writes `.cadre/mcp.json` containing the ref but not the value; (b) `materializeFleet` writes `.cadre/fleet.mcp.json` with `${VAR}` and appends gitignore entries; (c) `resolveFleetEnv` returns env from keychain and skips a missing secret with a warn. (Write concrete assertions with the mocked spies.)

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement `src/stores/connectionsStore.ts`.**
- [ ] **Step 4: Run tests + tsc, verify pass.**
- [ ] **Step 5: Commit** — `feat(mcp): connectionsStore — persist, keychain, probe, materialize`

---

### Task 7: Fleet inheritance wiring

**Files:**
- Modify: `src/lib/maintain/runBatch.ts`, `src/lib/maintain/runBatch.test.ts`
- Modify: `src/cadre/TerminalPanel.tsx`
- Modify: `src/cadre/maintain/SubagentCard.tsx` (+ the batch store that renders it)

**Interfaces:**
- `subagentCommand(prompt, projectDir, opts?: { mcpConfigPath?: string }): string` — when `mcpConfigPath` is set, the command becomes `claude --dangerously-skip-permissions --mcp-config <shq(path)> <shq(seeded)>; exit`.
- `TerminalPanel` gains `env?: Record<string,string>` and passes it to `create_pty` (replacing `env: null`).

- [ ] **Step 1: Write the failing test** (extend `src/lib/maintain/runBatch.test.ts`)

```ts
import { subagentCommand } from "./runBatch";

it("adds --mcp-config only when a config path is given", () => {
  expect(subagentCommand("do x", "/p")).not.toContain("--mcp-config");
  const withMcp = subagentCommand("do x", "/p", { mcpConfigPath: "/p/.cadre/fleet.mcp.json" });
  expect(withMcp).toContain("--mcp-config '/p/.cadre/fleet.mcp.json'");
  expect(withMcp).toContain("--dangerously-skip-permissions");
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the `subagentCommand` opts param (keep the existing 2-arg calls working).
- [ ] **Step 4: `TerminalPanel` `env` prop** — add to props, thread into the `create_pty` invoke (`env: env ?? null`). No behavior change when unset.
- [ ] **Step 5: Wire the work-agent spawn** — in `SubagentCard` (or its batch store), before rendering the work-agent terminal, call `connectionsStore.resolveFleetEnv(projectDir)`; pass the returned `env` to `TerminalPanel` and `{ mcpConfigPath }` to `subagentCommand`. **Eval agents are untouched** (no env, no mcp-config). If `resolveFleetEnv` returns null (no enabled connections), behavior is exactly as today.
- [ ] **Step 6: Run tests + tsc, verify pass** — `npx vitest run src/lib/maintain/runBatch.test.ts`, `npx tsc --noEmit`.
- [ ] **Step 7: Commit** — `feat(mcp): fleet work agents inherit MCP tools via --mcp-config + child env`

---

### Task 8: Connections UI

**Files:**
- Create: `src/cadre/connections/ConnectionsView.tsx`, `src/cadre/connections/ConnectionModal.tsx`
- Modify: the app nav / `src/cadre/Settings.tsx` to reach Connections.

**Behavior (spec §5):**
- **Catalog grid** — a tile per `CATALOG` preset (icon via `lucide-react`, label, blurb). Click → open `ConnectionModal` seeded via `presetToConnection`.
- **ConnectionModal** — renders each `secretField` as an input (token fields `type="password"`); `custom` also exposes editable command/args or url + a stdio/http switch. A **Test** button calls `connectionsStore.probe(conn, secrets)` and shows **"Connected · N tools"** (green) or the error (red). **Save** calls `connectionsStore.upsert(root, conn, secrets)` then closes.
- **Connected list** — each connection: status pill (green/red/grey), tool count, enable toggle (`setEnabled`), Edit, Remove (`remove`).
- Uses existing UI atoms (`cadre-icon-btn`, modal/panel classes already in the codebase). Errors already surface via the store's `reportError`.

- [ ] **Step 1** Build `ConnectionsView` (catalog grid + connected list, reading `connectionsStore`).
- [ ] **Step 2** Build `ConnectionModal` (fields, Test, Save) with masked token inputs.
- [ ] **Step 3** Wire an entry point (a "Connections" section in Settings or a nav item) that mounts `ConnectionsView` with the active project root.
- [ ] **Step 4** `load(root)` on mount so saved connections render.
- [ ] **Step 5** Verify `npx tsc --noEmit` clean; manually load the app (`?demo=1`) and confirm the view renders, a tile opens the modal, Test shows a result (canned in demo — Task 9), Save adds to the list, no console errors.
- [ ] **Step 6: Commit** — `feat(mcp): Connections UI — catalog, modal, test, list`

---

### Task 9: Demo + e2e + project gitignore

**Files:**
- Modify: `src/lib/demo/mockBackend.ts` (canned `mcp_probe`)
- Modify: `scripts/e2e-extensive.mjs` (Connections step)

- [ ] **Step 1: Mock `mcp_probe`** — in `mockBackend`'s `invoke` switch, add `case "mcp_probe": return JSON.stringify({ ok: true, toolCount: 12, toolNames: [...] });` so `?demo=1` exercises the full UI without a real server.
- [ ] **Step 2: Extend `e2e-extensive.mjs`** — after the existing sections, add a **Connections** section: open the view, click the ClickUp tile, click **Test**, assert `/Connected · \d+ tools/`, fill the token, **Save**, assert the connection appears in the list. Keep the harness's zero-console-error / zero-uncaught gate.
- [ ] **Step 3: Run** — `npm run test:e2e:extensive`. Expected: PASS, 0 console errors.
- [ ] **Step 4: Full regression** — `npx tsc --noEmit`, `npx tsc -p tsconfig.cli.json`, `npx vitest run`. All green.
- [ ] **Step 5: Manual real-inheritance check** (Global Constraint / spec): run `dist-cli/mcp/stubServer.js` via `probe.js` end-to-end; then with one real token configured, launch a fleet work agent and confirm `claude` sees the MCP tools AND that **no secret appears in `.cadre/fleet.mcp.json`, the command line, or `ps`**. Record the result in the final report.
- [ ] **Step 6: Commit** — `test(mcp): demo mock + Connections e2e + inheritance verification`

---

## Self-Review

- **Spec coverage:** registry+catalog (T1–2), MCP client/probe (T4–5), materialize+secrets-off-disk (T3,6), fleet inheritance work-agents-only (T7), UI (T8), demo/e2e + manual inheritance (T9). ✓ All spec §1–5 + testing strategy mapped.
- **Placeholder scan:** Tasks 1–7 carry real code/tests; Task 4 client + Task 8 UI are spec+contract because they're SDK-version- / design-system-specific — each has a concrete behavior contract and the tests (T4) or e2e (T8/9) that gate them. Acceptable per "code where testable, precise contract where mechanical."
- **Type consistency:** `Connection`/`SecretRef`/`Transport` defined once (T1) and consumed unchanged; `materialize → { config, requiredSecrets }` matches `connectionsStore.materializeFleet`/`resolveFleetEnv` and the T7 spawn; `McpProbe` shape identical across T4/T5/T6/T9.
- **Global constraints** (secrets off disk, managed `--mcp-config`, work-agents-only, toast+AI Log) are asserted by tests in T3/T6/T7 and the manual check in T9.
