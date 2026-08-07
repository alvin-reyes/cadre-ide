# Maintain Cockpit — Staged Tasks → Fleet Run (Design)

**Date:** 2026-08-07
**Status:** Approved in brainstorm; pending spec review.
**Supersedes** the slice-1 `TaskQueue` intake in `src/cadre/maintain/` (immediate one-off dispatch → opaque `running` badge).

## Problem

The current Maintain view dispatches a task the instant you add it: it spawns a **headless** `claude -p` agent on an isolated `task/<id>` worktree, streams output only to the global AI Log, and sets the task badge to `running`. Slice 1 never observes the process again, so:

- The badge is **frozen at `running`** whether the agent is still working, has committed, or died on startup. (Verified on the HFT repo: five `task/*` worktrees, all pristine, several "running" since hours earlier.)
- There is **no per-agent terminal** — you cannot see what any agent is doing.
- Tasks run **one at a time on add**, with no way to line up a batch and launch it deliberately.

## Goal

Turn Maintain into a cockpit where you **stage a list of tasks**, then **Run** them as a **fleet of live subagents** you can watch — mirroring the existing Fleet view (`AgentOrgChart`), where each agent card shows a status pulse and a live output tail.

### The flow

1. **Stage.** Compose tasks in the left rail — from the **Prompts library** (a curated built-in catalog + your own) and/or the **Thoughts composer** — and add them to a **staged list**. Nothing runs yet.
2. **Run.** Hit **Run all**. Every staged task dispatches in parallel, each on its own isolated `task/<id>` git worktree, and a **new Fleet tab** opens in the main area showing one **subagent card** per task — live output tail + status pulse (`running → done/failed`, driven by the process, not a frozen badge).
3. **Maximize.** Each subagent card has a **maximize (⤢)** control that expands it to watch that one agent's progress in detail; restore returns to the grid.

### Locked decisions (from brainstorm)

- **New Fleet tab per Run** (past batches stay in their own tabs).
- **Isolated worktree per subagent** (reuse the existing `dispatchTask` engine).
- **Full intake this slice**: Prompts library (catalog + user prompts, categorized + search + favorites) **and** the Thoughts composer feed the staged list.
- **Prompts replace the old task-queue intake.** The Fleet cards are the runs view (status + live output in one place); there is no separate "runs list."
- **Status follows the process.** Reuse `waitForExit(ptyId)` to move a subagent `running → done` (exit 0) / `failed` (non-zero). No verify/triage step in this slice (that remains a later slice).

## Non-goals (this slice)

- The per-task verification wedge (repro test + frozen verify), error/log intake, and the triage queue — all deferred to later slices, as in the original Maintain plan.
- PR handoff (a `done` subagent stops on its `task/<id>` branch).
- Persisting live batches across app restart. Staged tasks persist; a running batch's PTYs die on quit (same constraint as terminals) — on restart the Fleet tab shows the last-known log tail but the process is gone. Slice keeps **batches session-only**; only the **staged list** is persisted.
- Cross-project prompt sync/sharing. User prompts are stored locally.

## Architecture

Seven units, each independently testable. Pure logic (prompt filtering, task/batch reducers, batch orchestration) is unit-tested with injected deps, mirroring `dispatch.test.ts` / `tasks.test.ts`. UI is verified by running the app.

### 1. Prompt model + built-in catalog — `src/lib/maintain/prompts.ts`, `promptCatalog.ts`

```ts
export type PromptCategory =
  | "Testing" | "Refactor" | "Debug" | "Review" | "Git" | "Docs"
  | "Dependencies" | "Performance" | "Security";

export interface Prompt {
  id: string;          // stable slug for built-ins; generated id for user prompts
  title: string;
  body: string;        // the task text inserted into the composer
  category: PromptCategory;
  builtin: boolean;
}
```

- `promptCatalog.ts` exports `BUILTIN_PROMPTS: Prompt[]` — an **extensive** curated set spanning every category (e.g. Testing: "Write a failing test for …", "Add edge-case coverage to …"; Refactor: "Extract … into a well-named function"; Debug: "Reproduce and isolate …"; Review: "Review this diff for correctness bugs"; Git: "Write a conventional-commit message for staged changes"; Docs: "Document the public API of …"; Dependencies: "Bump … and fix breakage"; Performance: "Profile and speed up …"; Security: "Audit … for injection/authz issues"). Target ≥ 5 per category.
- Pure helpers (unit-tested): `searchPrompts(prompts, query)`, `groupByCategory(prompts)`, `mergePrompts(builtin, user, favorites)` (favorites float to a Favorites group; dedupe by id).

### 2. Prompts store — `src/stores/promptsStore.ts`

Zustand store, **globally** persisted to `localStorage` (prompts are reusable across projects, not per-project):

- State: `userPrompts: Prompt[]`, `favoriteIds: string[]`.
- Actions: `addPrompt({title, body, category})`, `updatePrompt(id, patch)`, `deletePrompt(id)` (user prompts only), `toggleFavorite(id)` (works on built-ins too, by id).
- `allPrompts()` selector merges `BUILTIN_PROMPTS` + `userPrompts` and marks favorites.

### 3. Staged tasks + batches (model) — extend `src/lib/maintain/tasks.ts`

Replace the single-status `MaintainTask` intake with a staging + batch model:

```ts
export type SubagentStatus = "running" | "done" | "failed";

export interface StagedTask { id: string; prompt: string; createdAt: number; }

export interface SubagentRun {
  taskId: string;      // reused as the task/<id> branch id
  prompt: string;
  branch: string;      // task/<taskId>
  status: SubagentStatus;
  log: string;         // accumulated, ANSI-stripped tail for the card's LiveTerminal
}

export interface FleetBatch {
  id: string;
  createdAt: number;   // also the tab label ("Fleet · HH:MM")
  subagents: SubagentRun[];
}
```

Pure reducers (unit-tested): `makeStagedTask`, `removeStaged`, `makeBatchFromStaged(staged, now)`, `appendSubagentLog(batches, batchId, taskId, chunk)`, `setSubagentStatus(batches, batchId, taskId, status)`. All immutable, mirroring `setTaskStatus`.

### 4. Batch orchestration — `src/lib/maintain/runBatch.ts`

Pure glue over the low-level engine (injected deps → testable), reusing `dispatchTask`:

```ts
export async function runSubagent(
  deps: DispatchDeps & { waitForExit: (ptyId: number) => Promise<{ exitCode: number | null }> },
  input: { repoPath: string; worktreeRoot: string; id: string; prompt: string; env?; model?;
           onStatus: (s: SubagentStatus) => void },
): Promise<void>;
```

- `dispatchTask(deps, …)` creates the worktree + spawns the agent; **on success** → `onStatus("running")` and capture `ptyId`.
- `deps.waitForExit(ptyId)` → `onStatus(exitCode === 0 ? "done" : "failed")`. **This is the fix** for the frozen badge.
- A spawn that throws → `onStatus("failed")`.
- The batch runs all subagents concurrently (`Promise.all` of `runSubagent`), each streaming to its own `SubagentRun.log`.

### 5. `useCadre` wiring (per-project slice)

- State: `stagedTasks: StagedTask[]` (persisted per project), `batches: FleetBatch[]` (session-only).
- Actions:
  - `stageTask(prompt)` → append a `StagedTask` (no dispatch).
  - `unstageTask(id)`.
  - `runStagedBatch()` → build a `FleetBatch` from `stagedTasks`, clear the staged list, append the batch, and for each subagent call `runSubagent` with `deps = { ...tauriOrchestratorDeps(root, chunk => appendSubagentLog(batchId, taskId, chunk)), waitForExit }` and `onStatus` patching the batch. Returns the new `batchId` so the UI can open/focus its Fleet tab.
- Remove `addMaintainTask` (the immediate-dispatch intake) and the old `tasks` field.

### 6. Fleet tab UI — `src/cadre/maintain/FleetTab.tsx`, `SubagentCard.tsx`

- `SubagentCard` mirrors `AgentOrgChart`'s `PoolAgentNode`: header with a mono task-id/branch badge, a status pulse (`cadre-dot-progress` running, success/warning on done/failed), the status label, and a `LiveTerminal` (reused from `agentShared.tsx`) tailing `subagent.log`. Adds a **maximize (⤢)** button in the header.
- `FleetTab` renders the batch as a responsive **grid** of `SubagentCard`s. When one is maximized, it fills the tab (a taller terminal view) with a **restore** control; others are hidden until restored. Maximize state is local to the Fleet tab.

### 7. Maintain main-area tabs + rewrite — `src/cadre/maintain/MaintainMainTabs.tsx`, rewrite `MaintainView.tsx`

- **Left rail** (fixed width): `PromptsRail` (search + categorized list + Favorites + "New prompt" editor) → `ThoughtsComposer` (multi-line staging text area; clicking a prompt inserts its body; "Add to list" stages it) → `StagedList` (the staged tasks with per-row remove and a primary **Run all** button; disabled when empty).
- **Main area**: `MaintainMainTabs` — a tab strip holding a persistent **Terminal** tab (the existing `TerminalTabs` Claude session, unchanged) plus one **Fleet** tab per batch. `runStagedBatch()` opens and focuses the new Fleet tab. Fleet tabs are closable; closing one drops the batch from state (its PTYs are already detached/dead or will be orphaned — acceptable this slice, matching current worktree behavior).
- `MaintainView` composes the header + left rail + `MaintainMainTabs`.

## Data flow

```
Prompts library ─┐
                 ├─► Thoughts composer ─(Add to list)─► Staged list
User types ──────┘                                          │
                                                     (Run all)│
                                                            ▼
                              runStagedBatch(): FleetBatch + new Fleet tab
                                                            │
                    for each StagedTask (concurrent):       ▼
        dispatchTask → worktree task/<id> + spawn claude (PTY)
                    │                         │
       onOutput chunk│                        │waitForExit
                    ▼                         ▼
      appendSubagentLog(batch,task)   setSubagentStatus(done|failed)
                    │                         │
                    └──────────► SubagentCard (LiveTerminal + pulse + ⤢)
```

## Error handling

- **Spawn failure** (worktree add, git, auth path missing) → subagent `failed`, the error text is streamed into its `log` (so the card shows *why*), and surfaced per the standing toast+AI-Log convention.
- **Non-zero exit** → `failed`; **exit 0** → `done`. No self-report; status is process-derived.
- **Empty staged list** → Run all disabled.
- **Stale worktree/branch** from a prior run with the same id → `dispatchTask` already cleans idempotently (`worktree remove --force`, `branch -D`).

## Testing

- Unit (Vitest, injected deps): prompt helpers (`searchPrompts`, `groupByCategory`, `mergePrompts`); task/batch reducers; `runSubagent` status transitions (spawn-ok→running→done, spawn-ok→running→failed on non-zero exit, spawn-throw→failed) with a fake `waitForExit`.
- UI verified by running the app against the HFT repo: stage 2–3 tasks → Run all → a Fleet tab opens with live cards → each moves `running → done`, output visible → maximize/restore works → the corresponding `task/<id>` branches carry commits (or the card shows the failure reason).

## Rollout / migration

- The old `TaskQueue.tsx`, `addMaintainTask`, `runMaintainTask`, and the single-status `tasks` field are removed. `tasks.ts` is extended (not deleted) — `taskBranch`/`makeTask` logic is retained where reused.
- No persisted-data migration needed: the old `tasks` were runtime-only.
