# MCP on the CLI — Slice 3 (`cadre connect`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `cadre` CLI the same MCP capabilities as the desktop — `cadre connect`/`connections`/`disconnect` and headless tracker sync in `run` — by wiring the SAME pure cores to Node.

**Architecture:** A Node connections twin (`src/cli/mcp/connectionsNode.ts`) mirrors `connectionsStore` using `fs` + the macOS `security` keychain CLI, reusing the pure `materialize`/`connections`/`catalog` and a newly-shared pure gitignore helper. New `cadre` subcommands drive it. Headless tracker sync reuses Slice-2's pure `mcpTracker` core with a Node `runSyncAgent`.

**Tech Stack:** TypeScript (CommonJS CLI build via `tsconfig.cli.json`), Node `child_process`/`fs`, vitest. No new npm deps.

**Spec:** `docs/superpowers/specs/2026-08-11-mcp-cli-connect-slice3-design.md` (binding).

## Global Constraints

- **One kernel, two faces:** no duplicated logic that can drift. The survivors-only resolution, `${VAR}` placeholders, gitignore upkeep, and sync policy live in the PURE layer (`src/lib/mcp/*`, `src/lib/integrations/mcpTracker.ts`); the Node twin supplies only I/O primitives (fs, `security`, `child_process`). A **drift-guard test** asserts the Node twin and the desktop store produce byte-identical `.cadre/mcp.json` and materialized config for the same connections.
- **Secrets keychain-only:** the CLI writes token values to the macOS keychain (service `dev.cadre.ide`) via `security`, never to `.cadre/mcp.json` (refs only) or `.cadre/{fleet,tracker}.mcp.json` (`${VAR}` placeholders). Secret values are NEVER printed to stdout/stderr.
- **Least privilege** (headless sync): the CLI sync agent spawns `claude -p --mcp-config <tracker.mcp.json> --allowedTools mcp__<id>__*` — no `--dangerously-skip-permissions`.
- **Non-blocking sync:** a tracker-sync failure logs a warning and never fails the `cadre run` lifecycle.
- The Node twin imports NO browser graph (no zustand/React/Tauri, no `src/lib/secrets.ts` which is Tauri-only). Both `npx tsc --noEmit` and `npx tsc -p tsconfig.cli.json` stay green each task.

## File Structure

- Create `src/lib/mcp/gitignore.ts` (+ test) — pure `mergeGitignore`; refactor `connectionsStore.appendIfMissing` to use it (drift-guard foundation).
- Create `src/cli/mcp/connectionsNode.ts` (+ test) — Node twin: keychain (`security`), fs, materialize/resolve, probe.
- Modify `src/cli/cadre.ts` — `cmdConnect`/`cmdConnections`/`cmdDisconnect` + usage + `main()` dispatch.
- Create `src/cli/mcp/trackerSyncNode.ts` (+ test) — Node `runSyncAgent` + `syncStoryNode` reusing `mcpTracker` pure core.
- Modify `src/cli/cadre.ts` `cmdRun` — fire headless tracker sync on transitions.

---

### Task 1: Shared pure gitignore helper (drift-guard foundation)

**Files:** Create `src/lib/mcp/gitignore.ts`, `src/lib/mcp/gitignore.test.ts`; Modify `src/stores/connectionsStore.ts` (`appendIfMissing`).

**Interfaces:**
```ts
/** Append any of `lines` not already present (exact-line match) to gitignore
 *  content. Tolerates empty/missing content. Returns the new content and whether
 *  anything changed (so a caller can skip a no-op write). Pure. */
export function mergeGitignore(existing: string, lines: string[]): { content: string; changed: boolean };
```

- [ ] **Step 1: Write the failing test** (`gitignore.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { mergeGitignore } from "./gitignore";

describe("mergeGitignore", () => {
  it("appends missing lines, exact-line match (no substring false-positive)", () => {
    const r = mergeGitignore("node_modules\n.cadre/mcp.json.bak\n", [".cadre/mcp.json", ".cadre/fleet.mcp.json"]);
    expect(r.changed).toBe(true);
    expect(r.content).toContain("\n.cadre/mcp.json\n");
    expect(r.content).toContain(".cadre/fleet.mcp.json");
    // .bak line must NOT have suppressed the exact .cadre/mcp.json line:
    expect(r.content.split("\n").filter((l) => l.trim() === ".cadre/mcp.json").length).toBe(1);
  });
  it("no-op when all present → changed:false, content unchanged", () => {
    const src = "a\n.cadre/mcp.json\n";
    const r = mergeGitignore(src, [".cadre/mcp.json"]);
    expect(r.changed).toBe(false);
    expect(r.content).toBe(src);
  });
  it("tolerates empty content and preserves a single trailing newline", () => {
    const r = mergeGitignore("", [".cadre/mcp.json"]);
    expect(r.changed).toBe(true);
    expect(r.content.endsWith("\n")).toBe(true);
    expect(r.content).toContain(".cadre/mcp.json");
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement `gitignore.ts`** — split on `\n`, trim for the membership set, append only absent lines, keep exactly one trailing newline; `changed` false iff nothing appended.
- [ ] **Step 4: Refactor `connectionsStore.appendIfMissing`** to read the file, call `mergeGitignore`, and write back only when `changed`. Keep its signature/behavior identical (its callers + all existing store tests must stay green). Run `npx vitest run src/stores/connectionsStore.test.ts` + `src/lib/mcp/gitignore.test.ts`.
- [ ] **Step 5: Commit** — `refactor(mcp): shared pure mergeGitignore (drift-guard foundation)`

---

### Task 2: Node connections twin

**Files:** Create `src/cli/mcp/connectionsNode.ts`, `src/cli/mcp/connectionsNode.test.ts`.

**Interfaces:**
```ts
// Injectable I/O so tests use in-memory fakes; defaults = real security + fs.
export interface NodeIo {
  getSecret(key: string): Promise<string | null>;         // security find-generic-password -s dev.cadre.ide -a <key> -w
  setSecret(key: string, value: string): Promise<void>;   // security add-generic-password -U -s dev.cadre.ide -a <key> -w <value>
  deleteSecret(key: string): Promise<void>;               // security delete-generic-password (ignore not-found)
  readFile(path: string): Promise<string | null>;         // null on ENOENT
  writeFile(path: string, content: string): Promise<void>;// mkdir -p parent
}
export function realNodeIo(): NodeIo;

export function readConnections(io: NodeIo, root: string): Promise<Connection[]>;                 // .cadre/mcp.json → connectionsFromFile ([] if missing/malformed)
export function writeConnections(io: NodeIo, root: string, list: Connection[]): Promise<void>;    // connectionsToFile
export function upsertConnection(io: NodeIo, root: string, conn: Connection, secrets: Record<string,string>): Promise<void>; // setSecret each, persist, materializeFleet
export function removeConnection(io: NodeIo, root: string, id: string): Promise<void>;            // deleteSecret refs, persist, materializeFleet
export function setRoleNode(io: NodeIo, root: string, id: string, role: "tracker"|undefined): Promise<void>;
export function materializeFleetNode(io: NodeIo, root: string): Promise<void>;                    // .cadre/fleet.mcp.json (${VAR}), gitignore-guard
export function resolveTrackerEnvNode(io: NodeIo, root: string): Promise<{ mcpConfigPath: string; env: Record<string,string>; serverKey: string } | null>;
```

Reuse the pure layer: `materialize` (`src/lib/mcp/materialize.ts`), `connectionsFromFile`/`connectionsToFile`/`trackerConnection`/`setRole` (`src/lib/mcp/connections.ts`), `mergeGitignore` (Task 1). The survivors-only resolution + `${VAR}` placeholders + gitignore lines MUST match `connectionsStore` exactly (`.cadre/fleet.mcp.json` gitignores `.cadre/fleet.mcp.json` + `.cadre/mcp.json`; tracker gitignores `.cadre/tracker.mcp.json`). Probe reuses `probeConnection` from `src/cli/mcp/client.ts`.

`realNodeIo`: keychain via `execFile("security", …)` (mirror `src/cli/planning.ts getPlanningKey`); fs via `node:fs/promises` (`readFile` catches ENOENT→null; `writeFile` `mkdir(dirname, {recursive:true})` first).

- [ ] **Step 1: Write failing tests** (`connectionsNode.test.ts`) with an in-memory `NodeIo` fake (Map-backed secrets + files):
  - `upsertConnection` writes secrets to the fake keychain, writes `.cadre/mcp.json` containing the ref but NOT the secret value, and writes `.cadre/fleet.mcp.json` with `${VAR}` (not the value) + gitignore entries.
  - **Drift guard:** for a fixed connection set, `writeConnections` output and `materializeFleetNode` output are byte-identical to what the store produces — assert by importing the pure `connectionsToFile` + `serializeConfig(materialize(...))` and comparing (the twin must produce exactly those bytes).
  - `resolveTrackerEnvNode`: designated+resolvable tracker → `{mcpConfigPath, env:{VAR:value}, serverKey}` + writes `.cadre/tracker.mcp.json` with `${VAR}`; missing secret → null (survivors-only); no tracker → null.
  - `removeConnection` deletes the refs' secrets and re-materializes.
- [ ] **Step 2: fail. Step 3: Implement `connectionsNode.ts`.**
- [ ] **Step 4:** `npx vitest run src/cli/mcp/connectionsNode.test.ts`; `npx tsc --noEmit`; `npx tsc -p tsconfig.cli.json` all green.
- [ ] **Step 5: Commit** — `feat(cli): Node connections twin (keychain + fs, drift-guarded)`

---

### Task 3: `cadre connect` / `connections` / `disconnect`

**Files:** Modify `src/cli/cadre.ts` (add `cmdConnect`/`cmdConnections`/`cmdDisconnect`, `usage()`, `main()` dispatch).

**Commands:**
- `cadre connect <presetId> [projectDir] [--token <t>] [--field K=V …] [--as-tracker] [--command <c> --args <a,b> --url <u>]`:
  - Look up the preset in `CATALOG` (`src/lib/mcp/catalog.ts`); `presetId` unknown → error + exit 1 with the valid list. For `custom`, require `--command`/`--args` (stdio) or `--url` (http).
  - Seed via `presetToConnection`; collect secret values from `--token` (→ the preset's single/primary required field) and `--field K=V` (→ named fields), else from env `CADRE_MCP_TOKEN`. Missing a required secret → error + exit 1 (never prompt-echo).
  - `probeConnection` to verify → print `Connected · N tools` (or the error, exit 1 without saving on probe failure — or save as status:"error"? SAVE only on success; on probe failure print the error and exit 1 without persisting).
  - `upsertConnection` (writes keychain + `.cadre/mcp.json` + materialize). If `--as-tracker`, `setRoleNode(…, "tracker")`.
  - Print a one-line success incl. the connection id + whether it's the tracker. NEVER print the token.
- `cadre connections [projectDir]`: list each connection — `id · label · status · N tools · [tracker]` — from `readConnections`. Empty → "No connections. Add one with: cadre connect <preset> …".
- `cadre disconnect <id> [projectDir]`: `removeConnection`; print confirmation. Unknown id → error + exit 1.

Positional parsing: mirror the existing `cmdApprove` pattern (a story id is `<e>.<s>`; other bare positionals are projectDir). Add the three commands to `usage()` and the `main()` switch.

- [ ] **Step 1:** Implement the three commands + usage + dispatch. Use `readConnections`/`upsertConnection`/`removeConnection`/`setRoleNode`/`probeConnection` from Task 2.
- [ ] **Step 2: Tests** — add focused tests for the pure arg-parsing helpers you introduce (e.g. `parseFieldFlags(["K=V","A=B"]) → {K:"V",A:"B"}`, preset→secrets mapping, unknown-preset handling) in `src/cli/cadre.test.ts` (or a new `src/cli/connectCli.test.ts` if cadre.ts isn't unit-friendly — extract the pure helpers so they're testable). Assert no secret value is ever placed in a printable string.
- [ ] **Step 3:** `node dist-cli/cli/mcp/...` not needed; verify `npx tsc -p tsconfig.cli.json` green, then a manual smoke: build (`npm run cadre:build`) and run `node dist-cli/cli/cadre.js connections /tmp/nonexistent` prints the empty-state, and `node dist-cli/cli/cadre.js help` shows the new commands. `npx vitest run` green.
- [ ] **Step 4: Commit** — `feat(cli): cadre connect / connections / disconnect`

---

### Task 4: Headless tracker sync in `cadre run`

**Files:** Create `src/cli/mcp/trackerSyncNode.ts` (+ test); Modify `src/cli/cadre.ts` (`cmdRun`).

**Interfaces:**
```ts
export type RunSyncAgentNode = (args: { prompt: string; mcpConfigPath: string; env: Record<string,string>; serverKey: string; cwd: string }) => Promise<string>;
export function realRunSyncAgentNode(): RunSyncAgentNode;   // spawn claude -p --mcp-config --allowedTools mcp__<key>__*, capture stdout
// Read .cadre/mcp-tracker.json, build intent (with existing id), run agent, parse, persist. Reuses mcpTracker pure core.
export function syncStoryNode(
  io: NodeIo, root: string, story: TrackerStory, status: TrackerStatus, verifyCmd: string | undefined,
  deps: { resolveTrackerEnv: typeof resolveTrackerEnvNode; runSyncAgent: RunSyncAgentNode },
): Promise<void>;   // never throws; logs a warning on failure
```

Reuse `src/lib/integrations/mcpTracker.ts`: `shouldSync`, `buildSyncPrompt`, `parseSyncResult`, `taskKey`, `trackerFromFile`/`trackerToFile`/`emptyTrackerFile`. Mirror the store's `syncStory` behavior (Slice 2): gate on `shouldSync` + a tracker connection; read `.cadre/mcp-tracker.json` (ENOENT-only → empty, transient read error → abort without overwrite, matching the store's I1 fix); build intent with `existing`; run agent; `parseSyncResult`; write. In the CLI the run loop is sequential, so no in-flight map is needed — but the ENOENT-only-vs-abort read discipline MUST match the store.

`realRunSyncAgentNode`: `execFile("claude", ["-p", prompt, "--mcp-config", mcpConfigPath, "--allowedTools", \`mcp__${serverKey}__*\`], { cwd, env: { ...process.env, ...env } })`, resolve stdout.

Wire into `cmdRun`: wherever `cmdRun` transitions a story's status (dispatch → InProgress, verified → Done, failure → Blocked — find the status-write points), after the transition call `syncStoryNode(io, root, story, status, verifyCmd, {resolveTrackerEnv: resolveTrackerEnvNode, runSyncAgent: realRunSyncAgentNode()})` — awaited but wrapped so a failure only logs (`log("cadre: tracker sync failed: …")`) and never aborts the run. Compute `verifyCmd` from the plan approval / project verification the CLI already reads.

- [ ] **Step 1: Write failing tests** (`trackerSyncNode.test.ts`) with in-memory `NodeIo` + a stub `runSyncAgent`: Done → writes id-map with the returned taskId; second Done same story → prompt carries the existing id (update), one entry; Draft → agent not called; transient read error → no overwrite (mirror the store's I1 test); rejecting agent → no throw, warning path.
- [ ] **Step 2: fail. Step 3: Implement `trackerSyncNode.ts` + wire `cmdRun`.**
- [ ] **Step 4:** `npx vitest run src/cli/mcp/trackerSyncNode.test.ts`; both tscs green; `npx vitest run` green.
- [ ] **Step 5: Commit** — `feat(cli): headless MCP tracker sync in cadre run`

---

## Self-Review

- **Spec coverage:** Node twin §1 (T2, on the T1 shared helper), CLI commands §2 (T3), headless sync §3 (T4), drift guard (T1 shared `mergeGitignore` + T2 byte-identical test). ✓
- **Placeholder scan:** T1/T2 carry full signatures + real tests; T3/T4 carry exact command/behavior specs + test lists (pure helpers extracted for testability). No vague steps.
- **Type consistency:** `NodeIo` defined in T2, consumed by T3/T4; `Connection`/`Transport`/`materialize`/`mcpTracker` types reused unchanged from Slices 1–2; `.cadre/{mcp,fleet.mcp,tracker.mcp,mcp-tracker}.json` filenames consistent with the shipped store; `RunSyncAgentNode` args match `resolveTrackerEnvNode`'s return.
- **Global constraints** (no drift, secrets keychain-only + never printed, least-privilege sync, non-blocking, no browser imports) enforced by T1's shared helper + T2's drift-guard + no-secret-in-file tests, T3's no-secret-in-output test, and T4's non-blocking + ENOENT-only-read tests.
