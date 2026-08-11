# MCP Tracker Sync — Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cadre pushes its verified status to any connected tracker MCP — a bounded, least-privilege agent turn performs the tracker-specific create/update; the engine owns the trigger and the task-id map.

**Architecture:** A pure core (`src/lib/integrations/mcpTracker.ts`) owns the sync intent, result parsing, sync policy, and the id-map file. A store (`src/stores/mcpTrackerStore.ts`) spawns a scoped `claude -p --mcp-config` sync agent (secret injected via child env, `--allowedTools mcp__<id>__*` only) and persists results, serialized per story. `bmadStore.setStatus` fires it alongside the existing gh tracker. A "Use as tracker" toggle designates the connection.

**Tech Stack:** TypeScript, React 19, zustand, Tauri, vitest. Reuses Slice 1 (`connections.ts`, `materialize.ts`, `connectionsStore`).

**Spec:** `docs/superpowers/specs/2026-08-11-mcp-tracker-sync-slice2-design.md` (binding).

## Global Constraints

- **Sync is downstream of truth.** A sync failure NEVER fails or blocks the engine's status transition or the build — it surfaces via `reportError` (toast + AI Log) and returns. The engine's status machine is untouched.
- **Least privilege.** The sync agent runs `claude -p` with `--allowedTools` scoped to the tracker server's tools ONLY (`mcp__<connectionId>__*`) — NOT `--dangerously-skip-permissions`, no Bash, no repo write.
- **Secrets keychain-only** (Slice 1 invariant): the one-connection tracker config `.cadre/tracker.mcp.json` holds `${VAR}` placeholders; the secret reaches the agent only via the injected child `env`.
- **No duplicate tasks:** persist the returned task id in `.cadre/mcp-tracker.json` and serialize sync per story key.
- **Do not clobber the gh tracker:** the MCP id-map is `.cadre/mcp-tracker.json`; the gh tracker's `.cadre/tracker.json` is untouched. Both trackers are independent + opt-in.
- Pure modules import no zustand/Tauri (CLI-reusable for Slice 3). Each task ends green: `npx tsc --noEmit` + `npx vitest run <touched>`.

## File Structure

- Create `src/lib/integrations/mcpTracker.ts` (+ test) — pure core.
- Modify `src/lib/mcp/connections.ts` (+ test) — add `role?: "tracker"` + `trackerConnection(list)` selector.
- Modify `src/stores/connectionsStore.ts` (+ test) — add `resolveTrackerEnv(root, connectionId)` (one-connection config) + `setRole(root, id, role)`.
- Create `src/stores/mcpTrackerStore.ts` (+ test) — `syncStory` orchestration with an injectable `runSyncAgent`.
- Modify `src/stores/bmadStore.ts` — fire MCP sync in `setStatus`.
- Modify `src/cadre/connections/ConnectionsView.tsx` — "Use as tracker" toggle.
- Modify `src/lib/demo/mockBackend.ts` + `scripts/e2e-extensive.mjs` — canned sync-agent + e2e.

---

### Task 1: Pure tracker core

**Files:** Create `src/lib/integrations/mcpTracker.ts`, Test `src/lib/integrations/mcpTracker.test.ts`

**Interfaces (Produces):**
```ts
export interface TrackerStory { epic: number; story: number; title: string; acceptanceCriteria?: string; }
export type TrackerStatus = "Draft"|"Approved"|"InProgress"|"InReview"|"Done"|"Failed"|"Blocked";
export interface SyncIntent { story: TrackerStory; status: TrackerStatus; verifyCmd?: string; existing?: { taskId: string; url?: string }; }
export interface McpTrackerFile { version: 1; connectionId: string; tasks: Record<string, { taskId: string; url?: string }>; }
export function taskKey(s: { epic: number; story: number }): string;      // `${epic}.${story}`
export function shouldSync(status: TrackerStatus): boolean;                // Draft/Approved → false; else true
export function buildSyncPrompt(intent: SyncIntent): string;
export function parseSyncResult(raw: string): { taskId: string; url?: string };  // extracts JSON; throws on no id
export function trackerToFile(f: McpTrackerFile): string;
export function trackerFromFile(raw: string): McpTrackerFile | null;       // malformed → null
export function emptyTrackerFile(connectionId: string): McpTrackerFile;
```

- [ ] **Step 1: Write the failing test** (`mcpTracker.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import {
  taskKey, shouldSync, buildSyncPrompt, parseSyncResult,
  trackerToFile, trackerFromFile, emptyTrackerFile,
} from "./mcpTracker";

describe("mcpTracker core", () => {
  it("taskKey + shouldSync policy", () => {
    expect(taskKey({ epic: 1, story: 2 })).toBe("1.2");
    expect(shouldSync("Draft")).toBe(false);
    expect(shouldSync("Approved")).toBe(false);
    for (const s of ["InProgress","InReview","Done","Failed","Blocked"] as const)
      expect(shouldSync(s)).toBe(true);
  });

  it("buildSyncPrompt embeds story, status, verify, existing id, and demands strict JSON", () => {
    const p = buildSyncPrompt({
      story: { epic: 1, story: 2, title: "Add login", acceptanceCriteria: "user can log in" },
      status: "Done", verifyCmd: "npm test", existing: { taskId: "abc123" },
    });
    expect(p).toMatch(/1\.2|\[1\.2\]/);
    expect(p).toContain("Add login");
    expect(p).toContain("Done");
    expect(p).toContain("npm test");
    expect(p).toContain("abc123");            // update, not create
    expect(p).toMatch(/only.*json/i);          // strict-JSON demand
  });

  it("buildSyncPrompt without existing id instructs create", () => {
    const p = buildSyncPrompt({ story: { epic: 2, story: 1, title: "X" }, status: "InProgress" });
    expect(p).toMatch(/creat/i);
  });

  it("parseSyncResult extracts JSON from prose, throws on no id", () => {
    expect(parseSyncResult('done: {"taskId":"T-9","url":"https://x/T-9"}')).toEqual({ taskId: "T-9", url: "https://x/T-9" });
    expect(parseSyncResult('{"taskId":"T-1"}')).toEqual({ taskId: "T-1" });
    expect(() => parseSyncResult("no json here")).toThrow();
    expect(() => parseSyncResult('{"url":"x"}')).toThrow();   // missing taskId
  });

  it("tracker file round-trips; malformed → null; empty helper", () => {
    const f = emptyTrackerFile("clickup");
    expect(f).toEqual({ version: 1, connectionId: "clickup", tasks: {} });
    const withTask: typeof f = { ...f, tasks: { "1.2": { taskId: "T-9" } } };
    expect(trackerFromFile(trackerToFile(withTask))).toEqual(withTask);
    expect(trackerFromFile("{bad")).toBeNull();
    expect(trackerFromFile(JSON.stringify({ version: 9 }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify fail.**
- [ ] **Step 3: Implement `mcpTracker.ts`.** `buildSyncPrompt` must clearly instruct: you have tracker MCP tools; ensure a task exists for `[epic.story] title` (+ acceptance criteria if present); set status to `<status>`; if a Done with verifyCmd, add comment "✅ Verified by Cadre — `<cmd>` passed"; if `existing.taskId` present update it else create; reply with ONLY a JSON object `{"taskId":"…","url":"…"}`. `parseSyncResult` finds the last `{…}` block, JSON.parses, requires a non-empty `taskId`. `shouldSync`: `status !== "Draft" && status !== "Approved"`.
- [ ] **Step 4: Run tests + tsc, verify pass.**
- [ ] **Step 5: Commit** — `feat(mcp): pure tracker-sync core (intent, parse, policy, id-map)`

---

### Task 2: Connection `role` + tracker selector

**Files:** Modify `src/lib/mcp/connections.ts`, `src/lib/mcp/connections.test.ts`

**Interfaces:**
- Add optional `role?: "tracker"` to `Connection` (backward compatible; `connectionsFromFile` still parses old files).
- Produces: `export function trackerConnection(list: Connection[]): Connection | null;` — the single ENABLED connection with `role === "tracker"`, else null. `export function setRole(list, id, role): Connection[]` — sets role on `id`, CLEARS `role` on all others (at most one tracker).

- [ ] **Step 1: Write failing tests** (extend `connections.test.ts`)

```ts
import { trackerConnection, setRole, addConnection, type Connection } from "./connections";
const mk = (id: string, patch: Partial<Connection> = {}): Connection => ({
  id, presetId: "clickup", label: id,
  transport: { kind: "stdio", command: "npx", args: [], env: {} },
  secretRefs: [], enabled: true, status: "connected", ...patch,
});
it("setRole keeps at most one tracker; trackerConnection returns the enabled one", () => {
  let l = [mk("a"), mk("b")];
  l = setRole(l, "a", "tracker");
  expect(trackerConnection(l)?.id).toBe("a");
  l = setRole(l, "b", "tracker");                 // moves the role
  expect(l.find(c => c.id === "a")?.role).toBeUndefined();
  expect(trackerConnection(l)?.id).toBe("b");
  l = setRole(l, "b", undefined);                  // clears
  expect(trackerConnection(l)).toBeNull();
});
it("trackerConnection ignores a disabled tracker", () => {
  const l = setRole([mk("a", { enabled: false })], "a", "tracker");
  expect(trackerConnection(l)).toBeNull();
});
```

- [ ] **Step 2: Run, fail. Step 3: Implement** (`role?: "tracker"` on the interface; the two functions). **Step 4: tests + tsc pass. Step 5: Commit** — `feat(mcp): connection tracker role + selector`

---

### Task 3: One-connection tracker env (`resolveTrackerEnv`)

**Files:** Modify `src/stores/connectionsStore.ts`, `src/stores/connectionsStore.test.ts`

**Interfaces (add to the store):**
```ts
setRole(root: string, id: string, role: "tracker" | undefined): Promise<void>;   // uses connections.setRole + save
resolveTrackerEnv(root: string): Promise<{ mcpConfigPath: string; env: Record<string,string>; serverKey: string } | null>;
```
`resolveTrackerEnv`: find `trackerConnection(connections)`; null if none. Materialize a ONE-connection config `{ mcpServers: { [conn.id]: … } }` (reuse `materialize([conn])`), resolve its secrets survivors-only (same rule as `resolveFleetEnv`: all required secrets must resolve or return null + reportError warn), write `<root>/.cadre/tracker.mcp.json`, append `.cadre/tracker.mcp.json` to the project `.gitignore` (reuse the existing append helper). Return `{ mcpConfigPath, env, serverKey: conn.id }`. Fail-loud on write error → reportError + null (same contract as resolveFleetEnv).

- [ ] **Step 1: Write failing tests** — mirror the `resolveFleetEnv` tests (mock `invoke` + `secrets` + `reportError`): (a) with a designated+resolvable tracker connection, writes `.cadre/tracker.mcp.json` with `${VAR}` and returns `{mcpConfigPath, env:{VAR:value}, serverKey}`; (b) missing secret → null + reportError, no phantom launch; (c) no tracker connection → null, no write.
- [ ] **Step 2: fail. Step 3: Implement** (reuse `materialize`, the survivors/gitignore/write helpers already in the store — factor the shared bits rather than copy). **Step 4: tests + tsc pass. Step 5: Commit** — `feat(mcp): resolveTrackerEnv — one-connection tracker config`

---

### Task 4: mcpTrackerStore (sync orchestration)

**Files:** Create `src/stores/mcpTrackerStore.ts`, Test `src/stores/mcpTrackerStore.test.ts`

**Interfaces:**
```ts
// Injectable so tests don't spawn a real agent. Default = real spawn-based impl.
export type RunSyncAgent = (args: {
  prompt: string; mcpConfigPath: string; env: Record<string,string>; serverKey: string; cwd: string;
}) => Promise<string>;   // resolves the agent's raw stdout
interface McpTrackerState {
  syncStory(root: string, story: TrackerStory, status: TrackerStatus, verifyCmd?: string): Promise<void>;
  __setRunSyncAgent(fn: RunSyncAgent): void;   // test seam
}
```

`syncStory` behavior:
1. If `!shouldSync(status)` → return.
2. `env = await useConnectionsStore.getState().resolveTrackerEnv(root)`; if null → return (no tracker / unresolved).
3. Serialize per `taskKey(story)` (in-flight promise map, like `trackerStore`) so concurrent transitions don't double-create.
4. Read `.cadre/mcp-tracker.json` (`read_file` → `trackerFromFile`, tolerate missing → `emptyTrackerFile(serverKey-owner)`). Look up `existing = file.tasks[key]`.
5. `prompt = buildSyncPrompt({ story, status, verifyCmd, existing })`.
6. `raw = await runSyncAgent({ prompt, mcpConfigPath, env, serverKey, cwd: root })`.
7. `{ taskId, url } = parseSyncResult(raw)`; merge into `file.tasks[key]`; write `.cadre/mcp-tracker.json` via `write_text_file`.
8. Any throw → `reportError("mcp tracker: sync", e)`, return (never rethrow).

Default `runSyncAgent` (real): build args `["--allowedTools", \`mcp__${serverKey}__*\`, "--mcp-config", mcpConfigPath, "-p", prompt]`; spawn via `tauriDeps` `makeSpawnAgent`-style `spawnAgent({ command: "claude", args, cwd, env }, onOutput)` capturing stdout, `waitForExit`, resolve the captured stdout. (Mirror `evaluationStore.runAgent`'s spawn+capture+waitForExit; `spawnAgent` already accepts `env`.)

- [ ] **Step 1: Write failing tests** (mock `@tauri-apps/api/core` invoke for read/write + `reportError`; inject a fake `runSyncAgent` via `__setRunSyncAgent`; stub `useConnectionsStore.resolveTrackerEnv`):
  - Done sync with no existing id → `runSyncAgent` called with a prompt containing "create", result `{"taskId":"T-1"}` written to `.cadre/mcp-tracker.json`.
  - Second sync for the same story → prompt contains the existing id "T-1" (update path), same task updated (no duplicate key).
  - Draft status → `runSyncAgent` NOT called.
  - `resolveTrackerEnv` null → `runSyncAgent` NOT called, no write.
  - `runSyncAgent` rejects → `reportError` called, no throw, tracker file not corrupted.
- [ ] **Step 2: fail. Step 3: Implement. Step 4: tests + tsc pass. Step 5: Commit** — `feat(mcp): mcpTrackerStore — agent-mediated sync, serialized, fail-safe`

---

### Task 5: Trigger in `setStatus`

**Files:** Modify `src/stores/bmadStore.ts` (+ its test if present)

- [ ] **Step 1:** In `setStatus`, after the existing gh tracker block (bmadStore.ts ~150-159), add — non-blocking, same fire-and-forget shape:
```ts
// Best-effort push to the MCP tracker (no-op unless a tracker connection is designated).
if (shouldSync(status as TrackerStatus)) {
  const st = get().projects[root]?.stories?.find((s) => s.epic === epic && s.story === story);
  const title = st?.title ?? `Story ${epic}.${story}`;
  const verification = useCadre.getState().projects[root]?.verification;
  const verifyCmd = (verification ?? []).filter(Boolean).join(" && ") || undefined;
  void useMcpTrackerStore.getState().syncStory(root, { epic, story, title }, status as TrackerStatus, verifyCmd).catch(() => {});
}
```
(Import `shouldSync`, `TrackerStatus` from `mcpTracker`, `useMcpTrackerStore`.) It must sit INSIDE the `try` after `story_set_status` succeeds (so we only sync real transitions), and must not affect the rollback path.
- [ ] **Step 2:** If `bmadStore.test.ts` exists, add a test that a successful `setStatus` to Done invokes `mcpTrackerStore.syncStory` (mock the store) and a failing `story_set_status` does NOT. Else verify via the mcpTrackerStore tests + tsc.
- [ ] **Step 3: tsc + full vitest pass. Step 4: Commit** — `feat(mcp): fire MCP tracker sync on engine status transitions`

---

### Task 6: "Use as tracker" toggle

**Files:** Modify `src/cadre/connections/ConnectionsView.tsx`

- [ ] **Step 1:** In each connected connection's row, add a **"Use as tracker"** control (a small toggle/badge, theme-token styled). Checked when `connection.role === "tracker"`. Clicking calls `useConnectionsStore.getState().setRole(root, id, isTracker ? undefined : "tracker")`. Show a single "Tracker" badge on the designated one. Only one can be active (the store's `setRole` enforces it). Reuse existing atoms/pills.
- [ ] **Step 2:** `npx tsc --noEmit` clean; smoke in `?demo=1` — toggling "Use as tracker" moves the badge, no console errors.
- [ ] **Step 3: Commit** — `feat(mcp): designate a connection as the tracker (UI)`

---

### Task 7: Demo mock + e2e

**Files:** Modify `src/lib/demo/mockBackend.ts`, `scripts/e2e-extensive.mjs`

- [ ] **Step 1: Demo sync agent.** In `mockBackend`, the sync agent is a `claude -p` spawned via `create_pty`; the demo already fakes `create_pty` transcripts. Make the demo emit a parseable sync reply for the tracker agent: when the spawned command args include `--mcp-config` pointing at `tracker.mcp.json` (or `-p` with a sync prompt), stream `{"taskId":"MOCK-123","url":"https://demo/MOCK-123"}` as output before exit, so `parseSyncResult` succeeds. Keep other `create_pty` behavior unchanged. (If simpler, key off the `--allowedTools mcp__*` arg.)
- [ ] **Step 2: e2e.** Extend `e2e-extensive.mjs` Connections section (or a new step): after saving the GitHub connection, click **Use as tracker**, assert the "Tracker" badge appears. (Full status-sync round-trip needs the engine + a real transition; assert at least the designation persists and no console errors. If feasible in the demo, trigger a status change and assert `.cadre/mcp-tracker.json` write via the mock — best-effort.) Preserve the zero-console-error gate. Screenshot `ext-11-tracker.png`.
- [ ] **Step 3:** `npm run test:e2e:extensive` PASS, 0 console errors. `npx tsc --noEmit`, `npx tsc -p tsconfig.cli.json`, `npx vitest run` all green.
- [ ] **Step 4: Commit** — `test(mcp): demo sync-agent mock + tracker-designation e2e`

---

## Self-Review

- **Spec coverage:** pure core §1 (T1), tracker designation §3 (T2, T6), one-connection env §2 (T3), sync orchestration §2 (T4), trigger §4 (T5), demo/e2e §5 (T7). ✓
- **Placeholder scan:** T1/T2 carry full code+tests; T3/T4 carry full contracts+test lists (reuse Slice-1 store patterns); T5 carries the exact insertion; T6/T7 are UI/e2e with concrete assertions. No vague steps.
- **Type consistency:** `TrackerStory`/`TrackerStatus`/`SyncIntent`/`McpTrackerFile` defined once in T1; `role`/`trackerConnection`/`setRole` in T2 consumed by T3/T4/T6; `resolveTrackerEnv`'s `{mcpConfigPath,env,serverKey}` matches T4's `runSyncAgent` args; `.cadre/mcp-tracker.json` and `.cadre/tracker.mcp.json` used consistently and distinct from gh's `.cadre/tracker.json`.
- **Global constraints** (non-blocking sync, least-privilege agent, secrets keychain-only, no gh clobber, no duplicates) asserted by T1 policy tests, T3 survivors test, T4 fail-safe + serialize tests, and the T5 non-blocking insertion.
