# Cadre Connections — MCP as the Integration Bus (Design)

**Date:** 2026-08-11
**Status:** Approved for planning (Slice 1)
**Related:** `[[tracker-integration-idea]]`, `docs/agentic-os.md` (Phase 3 — boot/onboarding)

## Problem

Cadre's only external integration today is GitHub, wired bespoke through the
`gh` CLI (`src/lib/integrations/githubTracker.ts`, `src/stores/trackerStore.ts`,
config in `.cadre/tracker.json`). Every new tool (ClickUp, Jira, Linear, …)
would mean another bespoke integration. We want **one integration mechanism —
MCP — that developers can plug and play**: pick a tool, paste a token, and it
"just works" across the fleet, the engine, and the CLI.

The fleet + eval agents already run `claude`, which reads MCP servers from a
project `.mcp.json` natively. So *agent* access to any MCP tool is nearly free —
Cadre's job is to manage the connection config and secrets seamlessly, and to
give the engine its own MCP client for two-way sync.

## North star (the plug-and-play moment)

A developer opens **Connections**, clicks a catalog tile (ClickUp / Jira /
Linear / Notion / GitHub / Sentry / Custom), pastes the token it asks for, and
sees **"Connected · 14 tools."** From that instant, every fleet agent, the
engine, and the CLI can use it. Nothing else to wire.

## Scope

- **Slice 1 (this spec → plan): Connections + fleet inheritance.** The registry,
  preset catalog, a Node MCP client (test/list/call), `.mcp.json`
  materialization for the fleet, the Connections UI, and keychain-backed
  secrets. Result: any MCP tool is plug-and-play for the fleet + eval agents.
  The existing gh-CLI GitHub tracker is left untouched.
- **Slice 2 (later): engine tracker sync over MCP.** Generalize `githubTracker`
  into an MCP-backed tracker (pull intake, push verified-Done). gh-CLI GitHub
  stays as one option.
- **Slice 3 (later): CLI.** `cadre connect` / `cadre connections`; headless
  `.mcp.json` write + sync on the same Node client.

## Architecture (Slice 1)

Four units, each with one responsibility and a clean boundary.

### 1. Connection registry — `src/lib/mcp/connections.ts` (pure) + `src/stores/connectionsStore.ts`

The pure model + reducers (no Tauri), unit-tested standalone. The store wires it
to Tauri (persistence + keychain + client).

```ts
// A resolved, storable connection. NEVER contains secret values.
export interface Connection {
  id: string;                 // stable slug, e.g. "clickup" or "clickup-2"
  presetId: string;           // catalog preset id, or "custom"
  label: string;              // user-facing name
  transport: StdioTransport | HttpTransport;
  secretRefs: SecretRef[];    // { field, keychainKey } — values live in keychain
  enabled: boolean;
  status: ConnStatus;         // "unconfigured" | "connected" | "error"
  toolCount?: number;         // last successful tools/list count
  lastError?: string;         // last test error, for the UI + AI Log
}

export interface StdioTransport {
  kind: "stdio";
  command: string;            // e.g. "npx"
  args: string[];             // e.g. ["-y", "@taazkareem/clickup-mcp-server"]
  env: Record<string, string>;// non-secret env; secrets injected from keychain by ref
}
export interface HttpTransport {
  kind: "http";
  url: string;                // e.g. "https://mcp.sentry.dev/mcp"
  headers: Record<string, string>; // non-secret headers; secret headers injected by ref
}

export interface SecretRef {
  field: string;              // logical name, e.g. "CLICKUP_API_TOKEN" or "Authorization"
  keychainKey: string;        // account under service dev.cadre.ide, e.g. "mcp.clickup.token"
  target: "env" | "header";   // where the resolved value is injected
}
```

Persistence file **`.cadre/mcp.json`** (git-ignored, added to `.gitignore`):

```jsonc
{
  "version": 1,
  "connections": [
    {
      "id": "clickup", "presetId": "clickup", "label": "ClickUp",
      "transport": { "kind": "stdio", "command": "npx",
        "args": ["-y", "@taazkareem/clickup-mcp-server"], "env": {} },
      "secretRefs": [
        { "field": "CLICKUP_API_TOKEN", "keychainKey": "mcp.clickup.token", "target": "env" }
      ],
      "enabled": true, "status": "connected", "toolCount": 14
    }
  ]
}
```

**Secrets never touch this file.** Token values are stored in the macOS keychain
(service `dev.cadre.ide`, account = `keychainKey`) via the existing `secrets.rs`
`set_secret`/`get_secret` commands. The file only holds *references*.

Pure reducers to unit-test: `addConnection`, `updateConnection`,
`removeConnection`, `setStatus`, `connectionsFromFile` / `connectionsToFile`.
(The claude-config projection lives in unit 4 as `materialize`, not here.)

### 2. Preset catalog — `src/lib/mcp/catalog.ts`

Static, pure list of presets. Each preset knows its transport template and the
secret fields it needs, so the UI renders a proper form instead of raw JSON.

| id | label | transport | secret field(s) | auth |
|---|---|---|---|---|
| `clickup` | ClickUp | stdio `npx -y @taazkareem/clickup-mcp-server` | `CLICKUP_API_TOKEN` (env), `CLICKUP_TEAM_ID` (env, optional) | API token |
| `jira` | Jira | stdio `npx -y @modelcontextprotocol/server-atlassian` (or Atlassian's) | `JIRA_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` (env) | API token |
| `linear` | Linear | stdio `npx -y @modelcontextprotocol/server-linear` | `LINEAR_API_KEY` (env) | API key |
| `github` | GitHub | stdio `npx -y @modelcontextprotocol/server-github` | `GITHUB_TOKEN` (env) | PAT |
| `sentry` | Sentry | http `https://mcp.sentry.dev/mcp` | `Authorization: Bearer <token>` (header) | token |
| `notion` | Notion | stdio `npx -y @notionhq/notion-mcp-server` | `NOTION_TOKEN` (env) | token |
| `custom` | Custom | user-entered stdio **or** http | user-defined | — |

> Exact package ids / endpoints are the **editable defaults** the preset seeds;
> the developer can override command/args/url in the modal. Implementer confirms
> the current package id / endpoint per preset at build time (they drift). Only
> token/env/header-authenticated servers are catalog presets in Slice 1;
> OAuth-browser-flow servers are supported via `custom` + a follow-up note, not
> as one-click presets yet.

Each preset: `{ id, label, blurb, docsUrl, transport: template, secretFields: [{ field, label, target, required, placeholder }] }`.

### 3. MCP client — `src/lib/mcp/client.ts` (Node, `@modelcontextprotocol/sdk`)

The single client both faces reuse. New npm dependency:
`@modelcontextprotocol/sdk` (canonical TS SDK). Pure of any UI/zustand so it
imports cleanly into the CLI later (like `nodeDeps`).

```ts
export interface McpProbe { ok: boolean; toolCount: number; toolNames: string[]; error?: string; }

// Resolve secretRefs → concrete env/headers, connect, initialize, tools/list, close.
export async function probeConnection(
  conn: Connection,
  resolveSecret: (keychainKey: string) => Promise<string | null>,
  opts?: { timeoutMs?: number },   // default 15000
): Promise<McpProbe>;

// For Slice 2/3: keep an open session.
export async function openSession(conn, resolveSecret): Promise<{
  listTools(): Promise<Tool[]>;
  callTool(name: string, args: unknown): Promise<unknown>;
  close(): Promise<void>;
}>;
```

- stdio transport → `StdioClientTransport({ command, args, env })`, secrets merged
  into `env`.
- http transport → `StreamableHTTPClientTransport(url, { headers })`, secret
  headers merged in.
- Always `initialize` then `tools/list`; wrap in a timeout so a hung server
  yields a clean `{ ok:false, error }` instead of hanging the UI.

**Desktop wiring:** the browser (WKWebView) can't spawn processes, so
`probeConnection` runs in the Rust/Node layer. Add a thin Tauri command
`mcp_probe(connectionJson)` in `src-tauri` that shells out to a tiny Node entry
(`node <appdir>/mcp-probe.js`) — mirroring how the app already spawns `claude`
and `node` — and returns the `McpProbe` JSON. The store calls `invoke("mcp_probe", …)`.
(Browser demo: `mockBackend` returns a canned `{ ok:true, toolCount:… }` so the
UI is exercisable in `?demo=1`.)

### 4. Fleet materialization — `src/lib/mcp/materialize.ts`

Enabled connections → a claude-format `.mcp.json` written at the project root
(git-ignored). Claude reads it; every fleet + eval `claude` subagent inherits
the servers. Secrets are resolved into `env` at write time.

```jsonc
// .mcp.json (claude's format — the fleet reads this)
{
  "mcpServers": {
    "clickup": { "command": "npx", "args": ["-y", "@taazkareem/clickup-mcp-server"],
      "env": { "CLICKUP_API_TOKEN": "<resolved>" } }
  }
}
```

- `materialize(connections, resolveSecret) → claudeConfig` is pure (unit-tested).
- The store writes it via `write_text_file` whenever connections change and on
  fleet launch.
- **`.mcp.json` and `.cadre/mcp.json` are added to `.gitignore`** — the
  materialized file holds resolved secrets, the registry file could leak intent.
- **Eval agents stay least-privilege:** they already run with a read-only
  `--allowedTools` allowlist. Materialization does not widen that; eval agents
  see the servers but Guardian/Audit prompts don't call write tools, and the
  allowlist gates Bash. (No change to the eval allowlist in Slice 1.)

### 5. Connections UI — `src/cadre/connections/ConnectionsView.tsx`

- **Catalog grid** of preset tiles (icon, label, blurb) + "Custom."
- Clicking a tile opens an **add/edit modal**: renders the preset's
  `secretFields` as inputs (token fields masked), plus editable command/args/url
  for `custom`. A **Test** button calls `probeConnection` and shows
  **"Connected · N tools"** (green) or the error (red). Save persists the
  connection + writes secrets to keychain + re-materializes `.mcp.json`.
- **Connected list**: each connection with status pill, tool count, enable
  toggle, edit, remove.
- Reached from Settings and surfaced in onboarding later (Phase 3).
- **Errors** (probe failures, keychain errors, write failures) surface as a
  toast **and** a persistent AI Log entry — per the standing rule `[[error-surfacing]]`.

## Data flow

```
Developer → Connections UI → connectionsStore
   ├─ writes secret value → keychain (dev.cadre.ide / keychainKey)   [never to disk]
   ├─ writes Connection (refs only) → .cadre/mcp.json
   ├─ Test → invoke("mcp_probe") → Node client → server initialize+tools/list → "N tools"
   └─ on change/launch → materialize() → .mcp.json (secrets resolved) → fleet claude inherits
```

## Error handling

- Probe timeout (15s default) → `{ ok:false, error:"timed out" }` → red status,
  toast + AI Log. Never hang the modal.
- Missing secret at materialize time → skip that server, warn in AI Log (don't
  write a broken `.mcp.json`).
- Keychain read/write failure → surfaced via `reportError` (toast + AI Log).
- `.cadre/mcp.json` malformed on load → treated as empty registry + one AI Log
  warning; never crash the view.

## Testing strategy

- **Pure units (vitest, no Tauri):** `connections.ts` reducers,
  `toClaudeMcpConfig` / `materialize` (round-trips, secret resolution, disabled
  connections excluded, missing-secret skip), `connectionsFromFile/toFile`
  parse + malformed handling, catalog preset → connection seeding.
- **Client:** `probeConnection` against a **local in-repo stub MCP server**
  (a tiny stdio server that returns 2 fake tools) — asserts `{ ok:true,
  toolCount:2 }` and timeout behavior against a non-responsive command.
- **Store:** persistence round-trip + status transitions with a mocked
  `invoke`/keychain (pattern already used by `trackerStore.test.ts`).
- **Demo/e2e:** `mockBackend` returns canned `mcp_probe`; extend
  `e2e-extensive.mjs` with a Connections step (open view → ClickUp tile → Test →
  "Connected · N tools" → Save → appears in list), asserting zero console errors.

## Non-goals (Slice 1)

- No engine tracker sync (Slice 2), no CLI commands (Slice 3).
- No OAuth-browser-flow presets (token/env/header auth only; OAuth servers via
  `custom` for now).
- No change to the eval read-only allowlist.
- Not removing the gh-CLI GitHub tracker.

## Open implementation confirmations (for the implementer, not blockers)

- Confirm current package id / endpoint per preset (they drift); the model
  treats them as editable defaults so a wrong default is user-correctable.
- Confirm `@modelcontextprotocol/sdk` transport class names for the installed
  version (`StdioClientTransport`, `StreamableHTTPClientTransport`).
