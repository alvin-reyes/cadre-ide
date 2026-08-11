# MCP on the CLI — Slice 3 (`cadre connect`) Design

**Date:** 2026-08-11
**Status:** Approved for planning (build AFTER Slice 2 lands — reuses its `mcpTracker.ts`)
**Builds on:** Slice 1 (Connections, shipped), Slice 2 (agent-mediated tracker sync).

## Problem

Slice 1/2 gave the desktop MCP connections + fleet inheritance + tracker sync. The `cadre` CLI (already runs new→plan→execute→done headlessly) has none of it. Slice 3 gives the CLI the **same** MCP capabilities via the same pure cores — "one kernel, two faces." A headless `cadre` run should be able to connect a tracker and push verified status, with zero desktop involved.

## Principle

No new logic — the CLI wires the SAME pure modules to Node that the desktop wires to Tauri, exactly as `src/cli/nodeDeps.ts` / `src/cli/planning.ts` already do. The pure cores (`src/lib/mcp/{connections,catalog,materialize}.ts`, `src/lib/integrations/mcpTracker.ts`) are already Tauri/zustand-free by Slice 1/2 design.

## Architecture

Three units.

### 1. Node connections twin — `src/cli/mcp/connectionsNode.ts`

The Node counterpart of `connectionsStore` (which is zustand/Tauri and can't run in the CLI):
- Read/write `.cadre/mcp.json` via `fs` (reuse `connectionsFromFile`/`connectionsToFile`).
- Keychain via the macOS `security` CLI (reuse the `execFile` pattern already in `src/cli/planning.ts`): `security add-generic-password -U -s dev.cadre.ide -a <key> -w <value>` to set, `find-generic-password … -w` to get, `delete-generic-password` to remove.
- `materializeFleet(root)` + `resolveFleetEnv(root)` — reuse `materialize()` and the SAME survivors-only + fail-loud + gitignore-append logic as the store (extract the shared policy into the pure layer if it isn't already, so both faces call one implementation and can't drift).
- `probe(conn)` → call `probeConnection` from `src/cli/mcp/client.ts` directly (already Node).

### 2. CLI commands — extend `src/cli/cadre.ts`

- `cadre connect <presetId> [dir] [--token <t>] [--field K=V ...] [--as-tracker]` — seed a Connection from the catalog preset, write its secret(s) to the keychain, persist `.cadre/mcp.json`, probe to verify ("Connected · N tools" / error), materialize `.cadre/fleet.mcp.json`, and (if `--as-tracker`) set `role:"tracker"` + write `.cadre/mcp-tracker.json` connectionId. `custom` accepts `--command/--args/--url`.
- `cadre connections [dir]` — list configured connections with status + tool count + which is the tracker.
- `cadre disconnect <id> [dir]` — remove connection + delete its keychain secrets + re-materialize.
- Reads secrets from flags or, if omitted, an env var (`CADRE_MCP_TOKEN`) — NEVER echoed; never printed back.

### 3. Headless tracker sync — reuse Slice 2 in the CLI lifecycle

- A Node `runSyncAgent(intent, conn)` (spawn `claude -p <buildSyncPrompt> --mcp-config <tracker.mcp.json>` with the `mcp__<server>__*` allowlist; capture stdout) — the Node twin of the desktop injected dep.
- Wire it into the CLI's status transitions in `cadre.ts` (`run`/`build`): on InProgress/Done/Blocked, if a tracker connection is designated, fire `mcpTracker` sync (using `buildSyncPrompt`/`parseSyncResult`/`shouldSync` + the id-map in `.cadre/mcp-tracker.json`). Non-blocking; a sync failure logs a warning and never fails the run.
- So `cadre build "<brief>" <dir> --auto` with a connected tracker pushes verified status headlessly.

## Data flow

```
cadre connect clickup ~/proj --token pk_… --as-tracker
  → secret → keychain (security add-generic-password)
  → .cadre/mcp.json (refs) + role:"tracker"
  → probe (dist-cli client) → "Connected · N tools"
  → materialize .cadre/fleet.mcp.json + .cadre/mcp-tracker.json(connectionId)

cadre run ~/proj --auto
  → dispatch→verify→review→integrate→Done  (unchanged)
  → on each transition: shouldSync? → runSyncAgent(buildSyncPrompt(intent)) → parseSyncResult → .cadre/mcp-tracker.json
```

## Shared-implementation guard

Slice 3's biggest risk is drift between the desktop store and the Node twin (materialize/survivors/gitignore/tracker policy). Mitigation: the survivors-only resolution + gitignore-append + `shouldSync`/`buildSyncPrompt`/`parseSyncResult` all live in the **pure** layer (`src/lib/mcp/*`, `src/lib/integrations/mcpTracker.ts`); both faces call them. Only the I/O primitives (fs vs Tauri, `security` vs keychain plugin, child_process vs pty) differ. A unit test asserts the Node twin and the store produce identical `.cadre/mcp.json` / `.cadre/fleet.mcp.json` bytes for the same connections.

## Testing strategy

- **Node twin (vitest, tmpdir):** `connectionsNode` round-trips `.cadre/mcp.json`, materializes identical bytes to the store for the same input (drift guard), appends gitignore idempotently, and `resolveFleetEnv` drops unresolvable connections (survivors-only) — mirroring the store's tests without Tauri.
- **CLI commands:** `cadre connections` on a seeded `.cadre/mcp.json` prints the expected list; `cadre connect` with a fake `security` shim writes the ref + sets tracker role; secret never appears in stdout.
- **Headless sync:** with a stub `runSyncAgent`, a CLI transition writes the id-map; second transition updates the same task.
- Both `tsc --noEmit` and `tsc -p tsconfig.cli.json` green.

## Non-goals (Slice 3)

- No inbound intake (Slice 2b).
- No interactive TUI for connect — flags/env only (an onboarding wizard is the separate Phase-3 onboarding work).
- No production Tauri bundling (still the tracked follow-up from Slice 1).

## Open confirmations (non-blocking)

- `security add-generic-password` flag for overwrite-if-exists (`-U`) — confirm at build time.
- Whether `resolveFleetEnv`/gitignore/survivors logic is already pure enough to share, or needs a small extraction from `connectionsStore.ts` into `src/lib/mcp/` (do the extraction rather than duplicate).
