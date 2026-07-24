# Persistent Team-Pool Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add an OPT-IN "persistent team pool" execution mode: N durable agent slots per project, each keeping a persistent Claude session (keyed by agent, resumed across tasks, reset after K tasks), pulling file-disjoint stories from the ready queue. Each story is still built in its own worktree and verified by the engine.

**Architecture:** Persistence = the SESSION, not the process. Each dispatch is still a fresh `claude -p --resume <agentSessionId>`, but the session id is keyed by AGENT SLOT (not story), so an agent carries codebase context across the tasks it picks up. No Rust/PTY change. Gated behind a `useTeamPool` setting; when off, behavior is byte-identical to today's ephemeral per-story dispatch.

**Tech Stack:** React 19 + TS, Zustand, Vitest, Tauri.

## Global Constraints

- Preserve all 362 frontend tests + Rust green after every task.
- **Opt-in:** everything is gated on `useSettingsStore.getState().useTeamPool` (default `false`). When false, the existing story-keyed ephemeral path runs unchanged — verify no behavior change.
- **Engine-owned invariant unchanged:** the engine still runs the frozen verification command and owns "Done" per story; per-story worktree isolation is preserved. Persistence only affects the agent's session/memory.
- Pure `src/lib/engine` modules stay dependency-injected (no Tauri/store imports); glue takes injected file deps.
- Errors via `reportError`.

---

## File Structure

- `src/lib/engine/teamSessions.ts` *(new)* — pure: agent-keyed session map (`agentId → {sessionId, taskCount}`), `resolveAgentSession` with the reset-after-K rule. Unit-tested.
- `src/lib/engine/pool.ts` *(new)* — pure: the pool-pull assignment strategy (which ready, file-disjoint stories can be assigned to idle slots given the in-flight file set). Unit-tested.
- `src/stores/settingsStore.ts` — add `useTeamPool`, `teamSize`, `sessionResetK` settings + setters.
- `src/lib/engine/projectSlices.ts` — `CadreSlice` gains `agentSlots: AgentSlot[]` and `agentLogs: Record<string,string>` (keyed agentId).
- `src/lib/engine/dispatch.ts`, `orchestrator.ts`, `runStory.ts` — thread an optional `agentId` through `DispatchInput`.
- `src/cadre/useCadre.ts` — `dispatchStory` resolves an AGENT session + routes output to `agentLogs` when `agentId` given; `dispatchReady` uses the pool-pull loop when `useTeamPool`.
- `src/cadre/AgentOrgChart.tsx`, `src/cadre/Team.tsx`, `src/cadre/Settings.tsx` — agent-slot nodes + roster + the settings section.

---

## Task 1: `teamSessions.ts` — agent-keyed sessions with reset-after-K

**Files:** Create `src/lib/engine/teamSessions.ts` + `teamSessions.test.ts`.

**Interfaces — Produces:**
```ts
export const TEAM_SESSIONS_PATH = ".cadre/team-sessions.json";
export interface AgentSession { sessionId: string; taskCount: number; }
export type AgentSessionMap = Record<string, AgentSession>; // agentId → session
export function parseAgentSessions(json: string): AgentSessionMap; // tolerant, never throws
export function serializeAgentSessions(map: AgentSessionMap): string;
// Pure decision: given the current entry + reset-K, decide resume vs fresh and the next map entry.
export function decideAgentSession(
  entry: AgentSession | undefined, resetK: number, newId: string
): { sessionId: string; resume: boolean; next: AgentSession };
// resume when entry exists AND entry.taskCount < resetK → {sessionId: entry.sessionId, resume:true, next:{sessionId, taskCount: taskCount+1}}
// else fresh → {sessionId: newId, resume:false, next:{sessionId:newId, taskCount:1}}
export interface SessionStoreDeps { readFile:(p:string)=>Promise<string>; writeFile:(p:string,c:string)=>Promise<void>; }
export async function resolveAgentSession(
  deps: SessionStoreDeps, root: string, agentId: string, resetK: number, genId: () => string
): Promise<{ sessionId: string; resume: boolean }>; // read map, decideAgentSession, write back, return
```

- [ ] **Step 1: Failing tests** (`teamSessions.test.ts`): `parseAgentSessions` tolerant (missing/corrupt → {}); round-trip serialize/parse; `decideAgentSession` — (a) undefined entry → fresh, `next.taskCount===1`, resume false; (b) entry with `taskCount < K` → resume, `sessionId` preserved, `next.taskCount` incremented; (c) entry with `taskCount === K` → fresh (new id), `next.taskCount===1`; (d) `resetK` boundary. `resolveAgentSession` with fake file deps: first call for `agent-0` mints + persists (resume false); second call resumes (resume true, count 2); the (K+1)th call resets.
- [ ] **Step 2: Run — FAIL.** `npx vitest run src/lib/engine/teamSessions.test.ts`
- [ ] **Step 3: Implement** per the signatures above. Mirror `agentSessions.ts`'s tolerant-parse + read/modify/write structure.
- [ ] **Step 4: Run — PASS** + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(agents): agent-keyed session store with reset-after-K (teamSessions.ts)`

## Task 2: `pool.ts` — the pool-pull assignment strategy

**Files:** Create `src/lib/engine/pool.ts` + `pool.test.ts`.

The async dispatch loop (Task 3) will repeatedly ask: "given the ready stories, the files currently being modified by in-flight assignments, and how many slots are free, which ready stories can I start now?" This function is that pure decision.

**Interfaces — Produces:**
```ts
export interface ReadyStory { id: string; files: string[]; } // files already repo-namespaced (as dispatchReady does today)
// Return the ready stories that can start now: file-disjoint from `inFlightFiles` AND from each other,
// up to `freeSlots`, in input order. Stories with NO files run alone (only when nothing else in flight).
export function pickAssignable(
  ready: ReadyStory[], inFlightFiles: Set<string>, freeSlots: number
): ReadyStory[];
```

- [ ] **Step 1: Failing tests** (`pool.test.ts`): 
  - all-disjoint, freeSlots≥count → all returned;
  - two stories sharing a file → only the first;
  - a story sharing a file with `inFlightFiles` → skipped;
  - `freeSlots` caps the count;
  - a no-files story returns alone only when `inFlightFiles` is empty and it's picked first (conservative, mirrors today's sealed-batch rule);
  - input order preserved.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.** Greedy first-fit: walk `ready`, maintain a running `used` set seeded from `inFlightFiles`; take a story if its files are disjoint from `used` (and, for a no-files story, only if `used` is empty so far); add its files to `used`; stop at `freeSlots`.
- [ ] **Step 4: Run — PASS** + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(agents): pool-pull assignment strategy (pool.ts)`

## Task 3: State + dispatch wiring (the pool execution path)

**Files:** `src/stores/settingsStore.ts`, `src/lib/engine/projectSlices.ts`, `src/lib/engine/dispatch.ts`, `src/lib/engine/orchestrator.ts`, `src/lib/engine/runStory.ts`, `src/cadre/useCadre.ts`.

- [ ] **Step 1: Settings.** In `settingsStore.ts` add `useTeamPool: boolean` (default `false`), `teamSize: number` (default `4`), `sessionResetK: number` (default `5`) to the `Settings` interface, the defaults, and `persistSettings`; add setters mirroring `resumeSessions`.
- [ ] **Step 2: State shape.** In `projectSlices.ts`, add to `CadreSlice`: `agentSlots: AgentSlot[]` and `agentLogs: Record<string, string>`, where `interface AgentSlot { agentId: string; currentStory: string | null; status: "idle" | "working" | "verifying"; }`. Initialize in `emptyCadreSlice()` (`agentSlots: []`, `agentLogs: {}`) and mirror in `mirrorCadre`. Add the same to `useCadre.ts`'s `CadreState` interface + initial state (tsc will demand it).
- [ ] **Step 3: Thread `agentId`.** Add optional `agentId?: string` to `DispatchInput` (`dispatch.ts`), `RunStoryInput`/`RunApprovedStoryInput` (`runStory.ts`/`orchestrator.ts`) — pure passthrough; no logic change inside the engine (the session id is resolved in the store and passed as `sessionId`/`resumeSession` as today).
- [ ] **Step 4: `dispatchStory` agent session + log routing.** In `useCadre.ts` `dispatchStory(epic, story, opts?)`, add `opts.agentId?`. When `useTeamPool && opts.agentId`: resolve the session via `resolveAgentSession(deps, root, opts.agentId, sessionResetK, genId)` (instead of `resolveStorySession`), and make the `onOutput` sink write BOTH `logs[storyKey]` (unchanged, so the Kanban card still shows output) AND `agentLogs[opts.agentId]` (so the org-chart agent node shows it). Set the slot's `currentStory`/`status` around the run (working → verifying → idle in `finally`). When `useTeamPool` is off OR no `agentId`, the existing story-session path runs unchanged.
- [ ] **Step 5: `dispatchReady` pool loop.** In `useCadre.ts` `dispatchReady`, branch on `useTeamPool`:
  - **Off:** the existing `scheduleParallel` batch loop, unchanged.
  - **On:** initialize `teamSize` slots (`agent-0..agent-(N-1)`) if not present. Maintain a `ready` queue (the `Approved`/`Failed` stories with repo-namespaced files) and a live `inFlightFiles: Set<string>`. Loop: while ready stories remain, `pickAssignable(ready, inFlightFiles, freeSlots)`; for each picked story, mark a free slot working, add its files to `inFlightFiles`, and `dispatchStory(epic, story, { silent:true, agentId, context }).finally(() => { free the slot; remove its files from inFlightFiles })` — WITHOUT awaiting, so slots run concurrently; then `await` a small settle (e.g. `Promise.race` on the in-flight set changing) before re-computing. A clean way: a worker-pump that resolves when all ready stories are dispatched AND all in-flight complete. Keep the merge still serialized via the existing `withMergeLock`. Cap concurrency at `teamSize`.
  - Both paths end with the same completion/toast behavior.
- [ ] **Step 6: Verify** `npx tsc --noEmit && npx vitest run` (362 + Task 1/2 tests). Add a focused test if the pool-loop logic is extractable; otherwise rely on `pool.ts`/`teamSessions.ts` unit tests + the review. Confirm with `useTeamPool:false` the suite is unchanged.
- [ ] **Step 7: Commit** — `feat(agents): opt-in team-pool dispatch (agent sessions + pool-pull scheduling)`

## Task 4: UI — agent-slot org chart, roster, and Settings

**Files:** `src/cadre/AgentOrgChart.tsx`, `src/cadre/Team.tsx`, `src/cadre/Settings.tsx`.

- [ ] **Step 1: Settings section.** Add a "Team pool" control set: a `useTeamPool` toggle (label: "Persistent team pool — agents keep context across tasks"), a `teamSize` number input (1–8), and a `sessionResetK` input ("fresh session every K tasks"). Mirror the existing toggle/field styling. Gate the size/K inputs on the toggle.
- [ ] **Step 2: Org chart by agent.** In `AgentOrgChart.tsx`, when `useTeamPool` is on, render one node per `agentSlot` (stable team members, idle + working): the node shows the agent name ("Agent 1"), its `currentStory` (id + title looked up in `stories`) or "idle", a status badge, and `agentLogs[agentId]` in the `LiveTerminal`. `OrchestratorNode`'s tally shows pool size (N agents · M working). When `useTeamPool` is off, the existing per-running-story nodes render unchanged (keep `selectRunningAgents`).
- [ ] **Step 3: Roster.** In `Team.tsx`, when `useTeamPool` is on, the Fleet section lists the N agent slots (name + current assignment) from `agentSlots` instead of the single static "Dev agent" row.
- [ ] **Step 4: Verify** `npx tsc --noEmit && npx vitest run && npm run build` green.
- [ ] **Step 5: Manual checklist (human):** enable the team pool (size 3, K=5) in Settings → approve+shard a backlog → Auto-execute → the Fleet org chart shows 3 stable agents pulling stories, each carrying context; confirm a 6th task on an agent mints a fresh session (check `.cadre/team-sessions.json` taskCount reset); disable the toggle → execution reverts to the ephemeral per-story path.
- [ ] **Step 6: Commit** — `feat(agents): team-pool org chart, roster, and Settings`

---

## Self-Review

**Spec coverage:** agent-keyed sessions + reset-after-K → Task 1. Pool-pull scheduling → Task 2 + Task 3 Step 5. Opt-in toggle + team size + K → Task 3 Step 1 + Task 4 Step 1. Per-agent state + org chart → Task 3 Step 2 + Task 4. ✓

**Type consistency:** `AgentSession`/`AgentSessionMap`/`resolveAgentSession` (Task 1) used in Task 3 Step 4; `ReadyStory`/`pickAssignable` (Task 2) used in Task 3 Step 5; `AgentSlot` (Task 3 Step 2) used in Task 4.

**Opt-in invariance:** every new path is gated on `useTeamPool`; with it false, `dispatchStory`/`dispatchReady` run the existing code (Task 3 Steps 4-5), so the 362 tests and current behavior are untouched.

**Engine invariant:** per-story worktree + frozen verification unchanged; persistence only swaps which session id is passed. No status is written by the UI.

**Placeholder scan:** exact new files, signatures, gating, and the reset-K rule specified. The hardest part (the async pool loop, Task 3 Step 5) is described with the concurrency contract; the reviewer should scrutinize slot-free/in-flight-file bookkeeping and that concurrency is capped at `teamSize`.
