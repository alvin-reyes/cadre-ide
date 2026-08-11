# MCP Tracker Sync — Slice 2 (Design)

**Date:** 2026-08-11
**Status:** Approved for planning
**Builds on:** `2026-08-11-mcp-connections-design.md` (Slice 1, shipped). Related: `[[tracker-integration-idea]]`.

## Problem

Cadre owns *execution truth* — a story is `Done` only when the engine's frozen verification passes and the review gate clears. Slice 1 made any tracker connectable over MCP. Slice 2 closes the loop the disciplined way: **Cadre pushes its verified status to whatever tracker you connected**, so your ClickUp/Jira/Linear board reflects machine truth — "your board, but Done means the tests actually passed."

The existing GitHub tracker (`src/lib/integrations/githubTracker.ts`, `gh` CLI) is the template — a pure core maps *story + status* → tracker operations via an injected runner, triggered fire-and-forget from `bmadStore.setStatus`, with `.cadre/tracker.json` holding the id map. It stays as-is. Slice 2 adds an **MCP tracker** alongside it.

## The fork we settled

An MCP tracker server exposes *arbitrary* tool names/schemas (ClickUp ≠ Jira ≠ Linear), so Cadre can't hardcode "create task / set done" like it does for `gh`. **Decision: agent-mediated, generic.** The engine owns the deterministic part (WHEN to sync, WHAT the intent is, persisting the task-id map); a **bounded agent turn** reads the connected server's tool schemas and performs the create/update (the tracker-specific HOW). Works with any tracker MCP, zero per-provider code. **Decision: outbound-only** for this slice (push status). Inbound intake (ticket → story) is Slice 2b.

## Architecture

Five units.

### 1. Pure core — `src/lib/integrations/mcpTracker.ts`

No Tauri/zustand/SDK — unit-tested and reused by the CLI (Slice 3). It owns the *intent* and the *bookkeeping*, never the transport.

```ts
export interface TrackerStory { epic: number; story: number; title: string; acceptanceCriteria?: string; }
export type TrackerStatus = "Draft"|"Approved"|"InProgress"|"InReview"|"Done"|"Failed"|"Blocked";

export interface SyncIntent {
  story: TrackerStory;
  status: TrackerStatus;
  verifyCmd?: string;              // frozen verification, surfaced on Done
  existing?: { taskId: string; url?: string };  // from the id-map; absent → create
}

/** The structured instruction handed to the sync agent. Deterministic text; the
 *  agent only chooses which MCP tools to call. Demands a strict JSON reply. */
export function buildSyncPrompt(intent: SyncIntent): string;

/** Parse the agent's reply → the concrete task ref to persist. Tolerant: extracts
 *  the JSON object {taskId, url?} from surrounding prose; throws on no id. */
export function parseSyncResult(raw: string): { taskId: string; url?: string };

/** `.cadre/mcp-tracker.json`: { "<epic>.<story>": { taskId, url? } }. */
export interface McpTrackerFile { version: 1; connectionId: string; tasks: Record<string, { taskId: string; url?: string }>; }
export function trackerToFile(f: McpTrackerFile): string;
export function trackerFromFile(raw: string): McpTrackerFile | null;   // malformed → null
export function taskKey(s: TrackerStory): string;                      // `${epic}.${story}`

/** The engine-owned status → sync policy: which statuses push, and whether to
 *  create-if-missing. e.g. Draft/Approved don't push; InProgress/InReview/Done/
 *  Blocked/Failed do. Pure, unit-tested. */
export function shouldSync(status: TrackerStatus): boolean;
```

`buildSyncPrompt` produces something like: *"You have MCP tools for an external issue tracker. Ensure a task exists for this work item and set its status. Item: [1.2] Add login. Acceptance: … Desired status: Done. The frozen verification command `npm test` passed — note this. Existing task id: none (create it) / abc123 (update it). Create the task if no id was given, else update that task. Add a short comment: '✅ Verified by Cadre — `npm test` passed.' Reply with ONLY a JSON object: {\"taskId\": \"…\", \"url\": \"…\"}."*

### 2. Sync agent runner — desktop: `src/stores/mcpTrackerStore.ts`; the injected `runSyncAgent`

The store wires the pure core to a bounded claude turn scoped to the *tracker* connection:
- Materialize a **one-connection** MCP config for the tracker (reuse Slice 1's `materialize`/`resolveFleetEnv`, but for a single connection id → a dedicated `.cadre/tracker.mcp.json`), inject its secret into the child env.
- Spawn `claude -p <buildSyncPrompt(intent)> --mcp-config <tracker.mcp.json>` **write-allowed for that server's tools only** (the tracker needs create/update — NOT `--dangerously-skip-permissions`; use an `--allowedTools` allowlist scoped to `mcp__<server>__*` plus nothing else, so the sync agent can call the tracker but not touch the repo). Capture stdout.
- `parseSyncResult(stdout)` → persist `{ taskId, url }` into `.cadre/mcp-tracker.json` under the story key.
- **Serialize per story** (in-flight promise map, like `trackerStore`) so two rapid transitions don't create duplicate tasks before the first id is written.
- Every failure → `reportError` (toast + AI Log). A sync failure NEVER blocks or fails the engine's own transition — the tracker is downstream of truth.

`runSyncAgent(intent, connection) → Promise<string>` is the injected dep (returns raw agent stdout), so the CLI (Slice 3) supplies a Node twin and the browser demo supplies a canned reply.

### 3. "Use as tracker" designation

Only one connection is the tracker (ClickUp yes, Sentry no). Add `role?: "tracker"` to the `Connection` model (Slice 1's `connections.ts`) — at most one connection carries it. Surfaced as a **"Use as tracker"** toggle in the Slice 1 Connections list. `.cadre/mcp-tracker.json`'s `connectionId` records it; sync is a no-op when no enabled connection is the tracker.

### 4. Trigger wiring — `src/stores/bmadStore.ts`

`setStatus` already fires the gh tracker sync (fire-and-forget, non-blocking, `.catch(()=>{})`). Add the MCP tracker sync right beside it, gated on `shouldSync(status)` and a designated tracker connection existing. Both trackers can run; each is independent and opt-in. The engine's status machine is untouched — sync is a side effect.

### 5. Demo/e2e

`mockBackend` returns a canned sync-agent stdout (`{"taskId":"MOCK-123","url":"https://…"}`) so the flow is exercisable in `?demo=1` without a real tracker. e2e asserts a status change writes the task id into `.cadre/mcp-tracker.json` (via the mock) and surfaces no console errors.

## Data flow

```
engine transition → bmadStore.setStatus(e,s,status)
  ├─ (existing) gh tracker sync .catch()                      [unchanged]
  └─ if shouldSync(status) && tracker connection designated:
       intent = { story, status, verifyCmd, existing:idMap[key] }
       prompt = buildSyncPrompt(intent)
       raw = runSyncAgent(intent, conn)   // claude -p --mcp-config <tracker.mcp.json>, allowedTools mcp__<server>__*
       { taskId, url } = parseSyncResult(raw)
       idMap[key] = { taskId, url } → write .cadre/mcp-tracker.json
     (serialized per story; failures → reportError; never blocks the transition)
```

## Determinism & safety

- **Engine owns truth.** The agent never decides status; it executes one structured intent. `shouldSync` (pure, tested) gates which transitions push.
- **No duplicates.** The persisted id-map + per-story serialization mean the second sync for a story updates the same task.
- **Least privilege.** The sync agent's `--allowedTools` is scoped to the tracker server's `mcp__<server>__*` tools only — it can't run Bash or touch the repo. NOT `--dangerously-skip-permissions`.
- **Non-blocking.** A tracker/agent failure surfaces via `reportError` but never fails the engine transition or the build.
- **Secrets** stay keychain-only (Slice 1 invariant); the tracker's one-connection config uses `${VAR}` placeholders + child-env injection, exactly like the fleet path.

## Testing strategy

- **Pure core (vitest):** `buildSyncPrompt` (contains story/status/verifyCmd/existing-id, demands strict JSON), `parseSyncResult` (extracts JSON from prose, throws on no id), `shouldSync` (Draft/Approved → false; InProgress/InReview/Done/Blocked/Failed → true), tracker-file round-trip + malformed → null, `taskKey`.
- **Store (vitest):** with a mocked `runSyncAgent`, a `setStatus` to Done writes the task id to `.cadre/mcp-tracker.json`; a second transition updates the SAME task (no create); per-story serialization; a rejected agent → `reportError`, no tracker-file corruption, engine transition still succeeds.
- **Demo/e2e:** canned sync-agent stdout; assert id-map write + zero console errors.

## Non-goals (Slice 2)

- No inbound intake (ticket → story) — that's Slice 2b.
- No per-provider adapters (agent-mediated is the mechanism).
- No change to the gh-CLI GitHub tracker.
- Not removing plan/review discipline — Done still requires verification + review gate first; sync only reflects it.

## Open confirmations (non-blocking)

- Exact `--allowedTools` syntax for scoping to a single MCP server (`mcp__<server>__*` pattern) — confirm against the installed claude CLI at build time; if wildcard scoping isn't supported, fall back to enumerating the server's tool names from a `tools/list` probe.
