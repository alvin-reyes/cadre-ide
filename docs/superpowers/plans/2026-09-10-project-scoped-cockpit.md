# Project-Scoped Maintain Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switching project tabs must stop killing the Maintain cockpit's `claude` session. Today a project switch changes `key={projectRoot}`, unmounting the terminal subtree and calling `kill_pty` — the PTY and the `claude` process inside it die, and switching back starts a fresh session under the restored scrollback.

**Architecture:** Replace the singleton cockpit with **one instance per open project root**, all mounted and visibility-toggled by `hidden()` — the pattern `CadreApp` already uses for view switching and Build⇄Maintain. The store is already per-project (`projects[root].{mode,stagedTasks,batches}`); only the components assume a singleton, reading the `mirrorCadre` mirror and calling actions that resolve `root` from `activeRoot`. A pure `nextMountedRoots()` owns the mount-set policy so it is testable in the node-only Vitest environment. No Rust changes.

**Tech Stack:** React 19, TypeScript (strict), Zustand, Vitest (node env), Tauri v2.

**Spec:** `docs/superpowers/specs/2026-09-10-project-scoped-cockpit-design.md`

## Global Constraints

- **Vitest runs in the node environment over `src/**/*.test.ts` only.** No DOM, no `.test.tsx`. Component behaviour cannot be unit tested — the mount-set policy must live in `src/lib/maintain/` and be tested there. Component tasks are verified by `npm run build` plus the demo script in Task 7.
- **`tsconfig.json` sets `strict`, `noUnusedLocals`, `noUnusedParameters`.** An unused import or an unused `root` parameter fails `npm run build`, not just lint.
- **Do not remove `key={projectRoot}`.** It is what stops project A's terminal being reused for project B (`CadreApp.tsx:79-81`). The keys stay; what changes is that A's element keeps existing.
- **Optional trailing `root` on actions must default to today's behaviour.** Existing callers, `useCadre.dispatchStory`, and the CLI face must be untouched. Mirror `bmadStore.setStatus`'s `root: string | undefined | null = get().activeRoot` signature.
- **A hidden cockpit must never mutate the active project.** This is the invariant the whole slice turns on — Task 6 tests it explicitly.
- **Do not modify `src/lib/engine/` or `src-tauri/`.** This slice is presentation + store wiring only. Fleet dispatch, worktrees, verification and the state machine are out of scope.
- **Errors surface through `reportError(source, err)`** — a toast *and* a persistent AI Log entry.
- **Commits are conventional with a scope**, e.g. `fix(maintain):`, `test(maintain):`, `refactor(maintain):`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/maintain/mountedCockpits.ts` | **Create.** Pure `nextMountedRoots()` mount-set policy. |
| `src/lib/maintain/mountedCockpits.test.ts` | **Create.** Node tests for the above. |
| `src/cadre/useCadre.ts` | **Modify.** Optional trailing `root` on the seven maintain actions. |
| `src/cadre/useCadre.test.ts` | **Modify.** Root-targeting + default-behaviour tests. |
| `src/cadre/CadreApp.tsx` | **Modify.** `maintainMounted: boolean` → `mountedCockpits: string[]`; map cockpits. |
| `src/cadre/MaintainView.tsx` | **Modify.** Take `root` as a prop instead of reading the store. |
| `src/cadre/maintain/MaintainMainTabs.tsx` | **Modify.** Select `projects[root].batches`; pass root to actions. |
| `src/cadre/maintain/IntakeRail.tsx` | **Modify.** Take `root`; select `projects[root].stagedTasks`. |
| `src/cadre/maintain/FleetTab.tsx` | **Modify.** Thread `root` through if it reads the mirror. |
| `scripts/e2e-project-switch.mjs` | **Create.** Regression script for the reported bug. |

---

### Task 1: Pure mount-set policy

**Files:**
- Create: `src/lib/maintain/mountedCockpits.ts`
- Test: `src/lib/maintain/mountedCockpits.test.ts`

- [ ] Write failing tests first (TDD), then implement:

```ts
export function nextMountedRoots(input: {
  mounted: string[];
  openRoots: string[];
  activeRoot: string | null;
  activeMode: ProjectMode;
}): string[];
```

- [ ] Rules: keep `mounted ∩ openRoots`, preserving order; append `activeRoot` when `activeMode === "maintain"` and it is open and not already present.
- [ ] Test cases: lazy add on entering Maintain; **no** add for a Build project; closing a project removes it; switching active root keeps **both** mounted; order is stable across calls; calling twice is idempotent; `activeRoot: null` is a no-op; an `activeRoot` not in `openRoots` is not added.
- [ ] **Verify:** `npx vitest run src/lib/maintain/mountedCockpits.test.ts`

---

### Task 2: Optional `root` on maintain actions

**Files:**
- Modify: `src/cadre/useCadre.ts`

- [ ] Add an optional trailing `root` to `stageTask`, `unstageTask`, `runStagedBatch`, `closeBatch`, `closeSubagent`, `markSubagentExited`, `reorderSubagent` — both the interface (`useCadre.ts:215-227`) and the implementations (`useCadre.ts:550-590`).
- [ ] Each body resolves `const target = root ?? get().activeRoot` (or `requireRoot()` when omitted, preserving the current throw/no-op behaviour per action — **match each action's existing semantics exactly**, do not unify them here).
- [ ] Do **not** change any call site yet. This task must be a pure superset of current behaviour.
- [ ] **Verify:** `npm run test` and `npm run build` both pass with zero call-site changes.

---

### Task 3: `MaintainView` takes a root prop

**Files:**
- Modify: `src/cadre/MaintainView.tsx`

- [ ] Replace `useBmadStore((s) => s.projectRoot)` (`MaintainView.tsx:16`) with a `root: string` prop; drop the `if (!projectRoot) return null` guard (the parent only mounts it for real roots).
- [ ] Pass `root` to `MaintainMainTabs` in place of the store-read `projectRoot`.
- [ ] **Verify:** `npm run build`

---

### Task 4: Root-scoped cockpit internals

**Files:**
- Modify: `src/cadre/maintain/MaintainMainTabs.tsx`, `src/cadre/maintain/IntakeRail.tsx`, `src/cadre/maintain/FleetTab.tsx`

- [ ] `MaintainMainTabs.tsx:16` — `useCadre((s) => s.batches)` → `useCadre((s) => s.projects[root]?.batches ?? EMPTY_BATCHES)`. Hoist a module-level `EMPTY_BATCHES: FleetBatch[] = []` so the selector does not return a fresh array each render (infinite re-render risk with Zustand).
- [ ] `MaintainMainTabs.tsx:77,93,94` — pass `root` to `closeBatch`, `closeSubagent`, `markSubagentExited`.
- [ ] `IntakeRail.tsx:15` — take a `root` prop; `s.stagedTasks` → `s.projects[root]?.stagedTasks ?? EMPTY_TASKS` (same hoisting rule); pass `root` to `stageTask`, `unstageTask`, `runStagedBatch`.
- [ ] `FleetTab.tsx` — audit for any mirror reads or root-less actions; thread `root` through where found. `ThoughtsDock` already takes `projectRoot` + `surfaceId` and needs no signature change.
- [ ] **Verify:** `npm run build`. Grep for remaining mirror reads under `src/cadre/maintain/`: `grep -rn "useCadre((s) => s\.\(batches\|stagedTasks\)" src/cadre/maintain/` must return nothing.

---

### Task 5: Mount one cockpit per project in `CadreApp`

**Files:**
- Modify: `src/cadre/CadreApp.tsx`

- [ ] Replace `const [maintainMounted, setMaintainMounted] = useState(false)` (`:58`) with `const [mountedCockpits, setMountedCockpits] = useState<string[]>([])`.
- [ ] Replace the `[mode]` effect (`:75-77`) and the `setMaintainMounted(...)` line inside the `[projectRoot]` effect (`:96`) with a single effect that calls `nextMountedRoots({ mounted, openRoots, activeRoot, activeMode })` and sets the result. `openRoots` comes from `useOpenProjects((s) => s.roots)`.
- [ ] **Keep the rest of the `[projectRoot]` effect intact** (`:82-97`) — the saved-view restore and `setFilesMounted`/`setTermMounted`/`setCtxMounted` behaviour is unrelated and still wanted.
- [ ] Render the map in place of the single `<MaintainView />` (`:232-237`):

```jsx
{mountedCockpits.map((root) => (
  <div key={root} style={hidden(mode === "maintain" && root === projectRoot)}>
    <MaintainView root={root} />
  </div>
))}
```

- [ ] Apply the same treatment to the dock terminal (`:247-251`): render one `<TerminalTabs>` per open root, `hidden(view === "terminal" && root === projectRoot)`, replacing the `termMounted` boolean. Keep `key={root}` and `surfaceId={`dock:${root}`}`.
- [ ] **Verify:** `npm run build`

---

### Task 6: No-cross-project-writes tests

**Files:**
- Modify: `src/cadre/useCadre.test.ts`

- [ ] For each root-taking action: with projects A and B in the store and **A active**, calling the action with `root: B` mutates B's slice and leaves A's slice byte-identical.
- [ ] For each: omitting `root` still targets the active root (regression guard for Task 2).
- [ ] `runStagedBatch(B)` while A is active stages into B's batches only.
- [ ] **Verify:** `npm run test`

---

### Task 7: Demo-mode regression script

**Files:**
- Create: `scripts/e2e-project-switch.mjs`

- [ ] Following the existing `scripts/e2e-lifecycle.mjs` pattern, drive demo mode: open two projects in Maintain mode, capture terminal A's pty id, switch to B, switch back to A.
- [ ] Assert **no** `[process exited: …]` text appears in pane A and the pty id is unchanged. This is the direct regression test for the reported bug.
- [ ] Add an `npm run` script entry alongside `test:e2e`.
- [ ] **Verify:** the script passes; then `npm run test:smoke` and `npm run test:e2e` still pass (demo mode is the only automated coverage of the real UI — it must keep working).

---

### Task 8: Full verification and manual confirmation

- [ ] `npm run test` — all suites green.
- [ ] `npm run build` — clean typecheck (strict + `noUnusedLocals`/`noUnusedParameters`).
- [ ] `cd src-tauri && cargo test` — unchanged and green (this slice touches no Rust).
- [ ] `npm run tauri build`, install to `/Applications/Cadre.app`, and **manually confirm the original report**: two projects open in Maintain mode, switch tabs back and forth, and the `claude` session in each survives with no `[process exited: …]` line.
- [ ] Decide the follow-up on the temporary PTY exit-reason instrumentation (revert, or promote to a `reportError` surface). The Rust `killed` set is worth keeping either way — see the spec's Follow-up section.
