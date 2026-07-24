# Auto-Scaling Role-Composed Fleet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the fleet a role-composed team that scales to demand — **1 QA + 1 DevOps agent always present, plus Dev agents that spin up/down with the ready Dev work** (capped) — and make this the DEFAULT execution model (retire the opt-in `useTeamPool` toggle). Each story is routed to the matching-role agent by its `storyRole`.

**Architecture:** Extend the existing persistent team pool. `AgentSlot` gains a `role`. A pure roster builder composes QA + DevOps + demand-scaled Dev slots. `dispatchReady` always runs the pool loop, partitioning ready stories by `storyRole` (already in `kanban.ts`): QA stories → the QA agent, `[ops]`/deploy → the DevOps agent, everything else → Dev agents (file-disjoint parallel, up to `maxDevAgents`), falling back to an idle Dev when a role agent is busy. The org chart + Team roster show the typed, scaling roster.

**Tech Stack:** React 19 + TS, Zustand, Vitest.

## Global Constraints

- Preserve all 521 tests + tsc + build green. The engine-owned invariant is untouched (engine verifies; worktree-per-story; UI never writes a verified status).
- **Scale up AND down:** the active Dev-agent count follows demand (min of file-disjoint ready Dev stories and `maxDevAgents`); QA + DevOps persist as slots (idle when no matching work).
- Never block: if a role's agent is busy, an idle Dev agent picks the story up (fallback), so nothing stalls.
- Errors via `reportError`. Merge stays serialized (`withMergeLock`).

## File Structure
- `src/lib/engine/agentSlots.ts` — `AgentSlot.role`; new `composeRoster(maxDev, existing)`; keep `agentLabel` (role-aware label).
- `src/lib/engine/pool.ts` — `partitionByRole(ready)` + role-aware assignment helper (pure, tested).
- `src/cadre/useCadre.ts` — `dispatchReady` always uses the role pool; the per-agent gating (`useTeamPool`) is removed / always-on; slot/log handling by role.
- `src/lib/engine/projectSlices.ts`/`useCadre.ts` state — `agentSlots` now role-typed (unchanged shape + a `role` field).
- `src/stores/settingsStore.ts` — `teamSize` → `maxDevAgents` (rename or repurpose); drop `useTeamPool` from the UI (keep the field defaulting true internally if simpler, but the pool is always on).
- `src/cadre/AgentOrgChart.tsx`, `src/cadre/Team.tsx`, `src/cadre/Settings.tsx` — typed roster (QA · DevOps · Dev×N scaling), `maxDevAgents` setting.

---

## Task 1: Role-composed roster + role-aware assignment (pure)

**Files:** `src/lib/engine/agentSlots.ts` (+ test), `src/lib/engine/pool.ts` (+ test).

- [ ] **Step 1: `AgentSlot.role`.** Add `role: "dev" | "qa" | "devops"` to `AgentSlot`. Stable agent ids: QA = `"agent-qa"`, DevOps = `"agent-devops"`, Dev = `"agent-dev-0".."agent-dev-(N-1)"`.
- [ ] **Step 2: `composeRoster(maxDev, existing): AgentSlot[]`.** Always emit the QA slot + the DevOps slot, then `clamp(maxDev,1,8)` Dev slots. Reuse an existing slot (by agentId, preserving `currentStory`/`status`) else a fresh idle one. Unit-test: composition (1 QA + 1 DevOps + N Dev), reuse preserves working state, clamp bounds. Update `agentLabel` to render "QA", "DevOps", and "Dev 1..N" from the ids.
- [ ] **Step 3: `partitionByRole(ready: ReadyStory[], role: (id) => "dev"|"qa"|"devops"): { dev, qa, devops }`** in `pool.ts` — split ready stories by their role (the caller supplies a role fn wrapping `storyRole`+the story title). Unit-test.
- [ ] **Step 4: role-aware pick.** Keep `pickAssignable` for the Dev pool (file-disjoint, up to free Dev slots). QA/DevOps are single-agent sequential (one story at a time on their slot). Add a small helper or document the assignment contract the store loop will follow. Test the Dev picking is unchanged for the dev partition.
- [ ] **Step 5: Verify** `npx tsc --noEmit && npx vitest run` green (521 + new). **Commit** — `feat(fleet): role-composed roster + role partition (composeRoster, partitionByRole)`

## Task 2: Role pool as the default execution path

**Files:** `src/cadre/useCadre.ts`, `src/stores/settingsStore.ts`, `src/lib/engine/projectSlices.ts`.

- [ ] **Step 1: Settings.** Rename `teamSize` → `maxDevAgents` (default 4) OR add `maxDevAgents` and deprecate `teamSize`; remove `useTeamPool` from the settings UI surface — the pool is always on (internally you may keep a constant). `sessionResetK` stays.
- [ ] **Step 2: `dispatchReady` (always role pool).** Remove the `if (!useTeamPool) { …ephemeral… }` branch — always run the pool. Build the roster via `composeRoster(maxDevAgents, existingSlots)`. Partition ready stories by role. Run three assignment tracks concurrently:
  - **Dev:** the existing pump — `pickAssignable(readyDev, inFlightFiles, freeDevSlots)`; assign to idle Dev slots; the ACTIVE Dev count = number currently dispatched (scales to demand). 
  - **QA:** if the QA slot is idle and `readyQa` non-empty, dispatch the next QA story to `agent-qa` (sequential — one at a time).
  - **DevOps:** same for `agent-devops`.
  - **Fallback:** a QA/DevOps story whose role agent is busy may be taken by an idle Dev slot (so it never blocks) — include such stories in the Dev pump when their role agent is occupied.
  - Keep the file-disjoint safety ACROSS all in-flight assignments (shared `inFlightFiles`), the `teamSize`→`maxDevAgents` concurrency reasoning, the deferred completion (`allDone`), and `withMergeLock`.
- [ ] **Step 3: `dispatchStory` role/slot wiring.** The per-agent session + `agentLogs` + slot `currentStory`/`status` handling (previously gated on `useTeamPool && agentId`) now always applies when an `agentId` is passed. Set the slot's status (`working`/`verifying`/`idle`) and route output to `agentLogs[agentId]` as today, minus the `useTeamPool` guard.
- [ ] **Step 4: Verify** `npx tsc --noEmit && npx vitest run` green. Update tests that assumed the ephemeral default or `useTeamPool` (e.g. any dispatchReady test) to the role-pool behavior. Add a focused test if the assignment tracks are extractable.
- [ ] **Step 5: Commit** — `feat(fleet): role pool is the default dispatch (QA + DevOps + demand-scaled Dev)`

## Task 3: UI — typed scaling roster

**Files:** `src/cadre/AgentOrgChart.tsx`, `src/cadre/Team.tsx`, `src/cadre/Settings.tsx`.

- [ ] **Step 1: Org chart.** Always render the role roster: the QA node + the DevOps node (idle or working) + the currently-active Dev agents (scaling — show working Dev agents; idle extra Dev slots may be hidden or shown muted). Each node's role badge from the slot role (QA / DevOps / Dev N). The Orchestrator tally shows the composition (e.g. "QA · DevOps · 3 Dev working"). Remove the old `useTeamPool`-off per-running-story rendering (or keep it as the fallback if no slots yet) — the pool is always on now.
- [ ] **Step 2: Team roster.** The Fleet section lists QA · DevOps · the Dev agents (with current assignments), from `agentSlots`.
- [ ] **Step 3: Settings.** Replace the `teamSize` control with **"Max Dev agents"** (1–8); remove the `useTeamPool` toggle; keep `sessionResetK`. A short caption: "QA and DevOps agents are always on; Dev agents scale to the ready work up to this cap."
- [ ] **Step 4: Verify** `npx tsc --noEmit && npx vitest run && npm run build` + `npm run test:smoke` green.
- [ ] **Step 5: Commit** — `feat(fleet): typed scaling roster in the org chart, Team, and Settings`

---

## Self-Review

**Spec coverage:** role-composed roster (QA+DevOps+Dev) → Task 1+2; auto-scale Dev to demand + up/down → Task 2 Step 2 (active Dev = demand-bounded); role-aware routing → Task 2 (partition + tracks + fallback); default model → Task 2 (remove useTeamPool gating); UI → Task 3.

**Type consistency:** `AgentSlot.role`, `composeRoster`, `partitionByRole` (Task 1) consumed by Task 2/3. `storyRole` (existing `kanban.ts`) supplies the role fn. `maxDevAgents` (Task 2) used by Task 3.

**Risk notes for reviewers:** (1) the three-track assignment must keep ONE shared `inFlightFiles` set + cap concurrency (Dev ≤ maxDev, +1 QA +1 DevOps) + never double-dispatch + resolve `allDone` exactly once. (2) removing the ephemeral default changes the execution path for everyone — confirm a simple all-Dev backlog still dispatches correctly. (3) the fallback (busy role agent → idle Dev) must not violate file-disjointness.
