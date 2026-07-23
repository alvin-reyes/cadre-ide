# Multi-Project Parallel-Live Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user open multiple Cadre projects as tabs, all live at once — agents dispatching in Project A keep updating A's board/status/logs while the user works in Project B — with instant tab switching and open-tabs persistence across restarts.

**Architecture:** Key the Rust engine by project root (`HashMap<PathBuf, CadreState>`) instead of a single `Option`. In the frontend, both stores (`bmadStore`, `useCadre`) keep a `projects: Record<root, Slice>` map plus an `activeRoot`, and mirror the active project's slice onto the top-level fields so existing selectors (`useBmadStore(s => s.stories)`) keep working unchanged. The invariant that makes parallel-live correct: **every mutation targets a slice by root — the active mirror is a read-through copy, never a write target for background work.** In-flight dispatch closures already capture `root`; they write to `projects[root]`, and the mirror is re-synced only when that root is active.

**Tech Stack:** Tauri v2 (Rust), React 19 + TypeScript, Zustand, Vitest, `cargo test`.

## Global Constraints

- Preserve all 139 passing frontend tests (`npx vitest run`) and the Rust tests (`cd src-tauri && cargo test`) green after every task.
- Existing selector call sites must not change: `useBmadStore(s => s.stories)`, `useBmadStore.getState().setStatus(...)`, `useCadre(s => s.phase)`, `useCadre.getState().dispatchStory(...)` all keep working via the active mirror.
- `.cadre/session.md` and `.cadre/agent-sessions.json` are already per-project on disk — do not change them.
- The mirror is derived state: after ANY slice mutation for the active root, re-run the mirror sync. Never let a selector read stale mirror fields.
- Zustand `set` merges shallowly at the top level; always spread `projects` when updating one slice: `set(s => ({ projects: { ...s.projects, [root]: next } }))`.

---

## File Structure

- `src-tauri/src/cadre_state.rs` — engine keyed by root; commands take a `root` param.
- `src/lib/engine/tauriDeps.ts` — pass `root` into `setStatus` / `getPlanApproval`; deps become root-scoped factories.
- `src/lib/engine/projectSlices.ts` *(new)* — pure helpers: the `mirror()` sync, `emptyBmadSlice()`, `emptyCadreSlice()`, `updateSlice()`. Unit-tested; no Tauri.
- `src/stores/openProjectsStore.ts` *(new)* — the tab list: `roots: string[]`, `activeRoot`, `open/close/setActive`, localStorage persistence.
- `src/stores/bmadStore.ts` — `projects` map + `activeRoot` + mirror; watchers route by root.
- `src/cadre/useCadre.ts` — `projects` map + mirror; dispatch closures write by captured root.
- `src/cadre/ProjectTabs.tsx` *(new)* — the tab bar UI.
- `src/cadre/CadreApp.tsx` — mount `ProjectTabs`; drive open/switch/close.

---

## Phase 1 — Rust engine keyed by project root

### Task 1: `CadreEngine` holds a map of projects

**Files:**
- Modify: `src-tauri/src/cadre_state.rs:178-260` (the `CadreEngine` struct + 5 commands)
- Test: `src-tauri/src/cadre_state.rs` (existing `#[cfg(test)]` module)

**Interfaces:**
- Consumes: existing `CadreState::new(root)`, `CadreState` methods (unchanged).
- Produces: commands now take `root: String` and select the per-root state, lazily inserting one if absent:
  - `open_project(engine, root)` — inserts `CadreState::new(root)` into the map (idempotent; replaces the entry for that root).
  - `story_set_status(engine, root, epic, story, status)`
  - `story_get_status(engine, root, epic, story)`
  - `is_own_write(engine, root, path, content)`
  - `approve_plan(engine, root, verification)`
  - `get_plan_approval(engine, root)`

- [ ] **Step 1: Change the engine struct to a keyed map**

```rust
use std::collections::HashMap;

/// Managed engine state: one `CadreState` per open project root, so multiple
/// projects are live at once. Empty until the first project is opened.
pub struct CadreEngine {
    states: Mutex<HashMap<PathBuf, CadreState>>,
}

impl CadreEngine {
    pub fn new() -> Self {
        Self { states: Mutex::new(HashMap::new()) }
    }
}
```

- [ ] **Step 2: Make `open_project` insert into the map**

```rust
#[tauri::command]
pub fn open_project(engine: tauri::State<'_, CadreEngine>, root: String) -> Result<(), String> {
    let key = PathBuf::from(&root);
    engine.states.lock().unwrap().insert(key, CadreState::new(root));
    Ok(())
}
```

- [ ] **Step 3: Add a `root` param to the four state commands**

Replace each command body's `guard.as_ref().ok_or("no project open")?` pattern with a map lookup by root. Example for `story_set_status`:

```rust
#[tauri::command]
pub fn story_set_status(
    engine: tauri::State<'_, CadreEngine>,
    root: String,
    epic: u32,
    story: u32,
    status: String,
) -> Result<(), String> {
    let guard = engine.states.lock().unwrap();
    let state = guard.get(&PathBuf::from(&root)).ok_or("project not open")?;
    // ... unchanged body using `state` ...
}
```

Apply the identical `root: String` + `guard.get(&PathBuf::from(&root)).ok_or("project not open")?` change to `story_get_status`, `is_own_write`, `approve_plan`, and `get_plan_approval`. Keep every method body otherwise unchanged.

- [ ] **Step 4: Update the existing Rust tests to pass a root**

In the `#[cfg(test)]` module, each test currently builds a `CadreState` directly (not through the engine), so most are unaffected. For any test that exercises the commands, thread the `tmp_root(...)` value as the new `root` argument. Run:

```bash
cd src-tauri && cargo test
```

Expected: PASS (same count as before).

- [ ] **Step 5: Register no new commands (signatures changed, names same) and build**

```bash
cd src-tauri && cargo check
```

Expected: compiles clean. `invoke_handler` list in `lib.rs` is unchanged (same command names).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/cadre_state.rs
git commit -m "refactor(engine): key CadreState by project root for multi-project"
```

### Task 2: Frontend passes `root` to the engine commands

**Files:**
- Modify: `src/lib/engine/tauriDeps.ts:123-151` (`setStatus`, `getPlanApproval`, the deps factories)
- Modify: `src/stores/bmadStore.ts:87-99, 62-75` (`setStatus`, `reconcileState` → `is_own_write`)
- Modify: `src/cadre/useCadre.ts` (any direct `invoke("approve_plan" | "get_plan_approval" | "story_*" | "is_own_write")` call)

**Interfaces:**
- Consumes: Task 1's root-param commands.
- Produces: `tauriRunStoryDeps(root, onOutput?)` and `tauriOrchestratorDeps(root, onOutput?)` — the `setStatus`/`getPlanApproval` deps close over `root`. `bmadStore.setStatus` invokes `story_set_status` with the store's active root.

- [ ] **Step 1: Make the deps factories take a root**

```ts
async function setStatus(root: string, epic: number, story: number, status: Status): Promise<void> {
  await invoke("story_set_status", { root, epic, story, status });
}
async function getPlanApproval(root: string): Promise<PlanApproval | null> {
  return invoke<PlanApproval | null>("get_plan_approval", { root });
}

export function tauriRunStoryDeps(root: string, onOutput?: OutputSink): RunStoryDeps {
  return {
    setStatus: (epic, story, status) => setStatus(root, epic, story, status),
    runGit,
    spawnAgent: makeSpawnAgent(onOutput),
    waitForExit,
    runVerification: makeRunVerification(onOutput),
    killAgent: (ptyId) => invoke("kill_pty", { id: ptyId }).then(() => {}),
  };
}

export function tauriOrchestratorDeps(root: string, onOutput?: OutputSink): OrchestratorDeps {
  return { ...tauriRunStoryDeps(root, onOutput), getPlanApproval: () => getPlanApproval(root) };
}
```

- [ ] **Step 2: Update `bmadStore` invokes to pass root**

In `reconcileState`: `invoke<boolean>("is_own_write", { root: get().projectRoot, path, content })`.
In `setStatus`: `invoke("story_set_status", { root: get().projectRoot, epic, story, status })`.
(`get().projectRoot` is the active mirror root — correct here because `setStatus` is only called for the active project's optimistic path; the dispatch engine path routes root explicitly via the deps in Phase 3.)

- [ ] **Step 3: Update `useCadre` invokes to pass root**

`approvePlan`: `invoke("approve_plan", { root, verification: cmds })` (root is `requireRoot()`, already in scope).
Any `tauriOrchestratorDeps(onOutput)` call becomes `tauriOrchestratorDeps(root, onOutput)`.

- [ ] **Step 4: Typecheck + tests**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: TS clean; 139 tests pass (deps signatures are exercised only through mocks that ignore the extra arg, but update any test that constructs `tauriRunStoryDeps`/`tauriOrchestratorDeps` if present).

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/tauriDeps.ts src/stores/bmadStore.ts src/cadre/useCadre.ts
git commit -m "refactor(engine): thread project root through the frontend engine deps"
```

---

## Phase 2 — bmadStore per-project slices + mirror

### Task 3: Pure slice + mirror helpers

**Files:**
- Create: `src/lib/engine/projectSlices.ts`
- Test: `src/lib/engine/projectSlices.test.ts`

**Interfaces:**
- Produces:
  - `interface BmadSlice { board: BoardState; stories: StoryCard[]; watchError: string | null }`
  - `emptyBmadSlice(): BmadSlice`
  - `mirrorBmad(projects: Record<string, BmadSlice>, activeRoot: string | null): { projectRoot: string | null; board: BoardState; stories: StoryCard[]; watchError: string | null }` — returns the active slice's fields (or an empty slice when `activeRoot` is null/absent), plus `projectRoot: activeRoot`.
  - `updateSlice<T>(map: Record<string, T>, root: string, patch: Partial<T>, empty: () => T): Record<string, T>` — returns a new map with `map[root]` shallow-merged with `patch` (creating from `empty()` if absent).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { emptyBmadSlice, mirrorBmad, updateSlice } from "./projectSlices";
import { emptyBoard } from "./board";

describe("projectSlices", () => {
  it("emptyBmadSlice has an empty board and no stories", () => {
    const s = emptyBmadSlice();
    expect(s.stories).toEqual([]);
    expect(s.watchError).toBeNull();
    expect(s.board).toEqual(emptyBoard());
  });

  it("updateSlice creates and merges a slice immutably", () => {
    const a = updateSlice<{ n: number; k: string }>({}, "/p", { n: 1 }, () => ({ n: 0, k: "" }));
    expect(a["/p"]).toEqual({ n: 1, k: "" });
    const b = updateSlice(a, "/p", { k: "x" }, () => ({ n: 0, k: "" }));
    expect(b["/p"]).toEqual({ n: 1, k: "x" });
    expect(b).not.toBe(a);
  });

  it("mirrorBmad reflects the active slice, or empty when none", () => {
    const slice = { ...emptyBmadSlice(), stories: [{ id: "1.1" } as never] };
    const m = mirrorBmad({ "/p": slice }, "/p");
    expect(m.projectRoot).toBe("/p");
    expect(m.stories).toBe(slice.stories);
    const none = mirrorBmad({ "/p": slice }, null);
    expect(none.projectRoot).toBeNull();
    expect(none.stories).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`Cannot find module './projectSlices'`)

```bash
npx vitest run src/lib/engine/projectSlices.test.ts
```

- [ ] **Step 3: Implement `projectSlices.ts`**

```ts
import { emptyBoard, type BoardState, type StoryCard } from "./board";

export interface BmadSlice {
  board: BoardState;
  stories: StoryCard[];
  watchError: string | null;
}

export function emptyBmadSlice(): BmadSlice {
  return { board: emptyBoard(), stories: [], watchError: null };
}

export function updateSlice<T>(
  map: Record<string, T>,
  root: string,
  patch: Partial<T>,
  empty: () => T
): Record<string, T> {
  const base = map[root] ?? empty();
  return { ...map, [root]: { ...base, ...patch } };
}

export function mirrorBmad(projects: Record<string, BmadSlice>, activeRoot: string | null) {
  const s = (activeRoot && projects[activeRoot]) || emptyBmadSlice();
  return { projectRoot: activeRoot, board: s.board, stories: s.stories, watchError: s.watchError };
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run src/lib/engine/projectSlices.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/projectSlices.ts src/lib/engine/projectSlices.test.ts
git commit -m "feat(stores): pure per-project slice + mirror helpers"
```

### Task 4: bmadStore holds a projects map with an active mirror

**Files:**
- Modify: `src/stores/bmadStore.ts` (whole store body)

**Interfaces:**
- Consumes: `emptyBmadSlice`, `mirrorBmad`, `updateSlice` (Task 3).
- Produces: `BmadState` gains `projects: Record<string, BmadSlice>`, `activeRoot: string | null`, `closeProject(root)`, `setActiveProject(root)`. Keeps the mirror fields `projectRoot / board / stories / watchError` and existing methods.

- [ ] **Step 1: Add the map + mirror to state shape**

Add to `BmadState` (keep the existing mirror fields):

```ts
projects: Record<string, BmadSlice>;
activeRoot: string | null;
closeProject: (root: string) => void;
setActiveProject: (root: string) => void;
```

- [ ] **Step 2: Introduce a `syncMirror` helper and route pushes by root**

Inside the store factory, add:

```ts
// Re-derive the active mirror from the projects map. Call after every slice change.
function syncMirror() {
  set((s) => mirrorBmad(s.projects, s.activeRoot));
}
// Push a reconciled board into a SPECIFIC project's slice (by root), then mirror.
function pushRoot(root: string, board: BoardState) {
  set((s) => ({ projects: updateSlice(s.projects, root, { board, stories: boardStories(board) }, emptyBmadSlice) }));
  syncMirror();
}
```

Change `reconcileState(path)` and `reconcileStory(path)` to take the owning `root` (bound when the watcher is registered in `openProject`) and call `pushRoot(root, reconcile(get().projects[root]?.board ?? emptyBoard(), …))`.

- [ ] **Step 3: `openProject` ADDS a project and its root-bound watchers**

Rewrite `openProject(root)` so it:
1. `await invoke("open_project", { root })`.
2. Seeds the slice: `set(s => ({ projects: { ...s.projects, [root]: emptyBmadSlice() }, activeRoot: root })); syncMirror();`
3. Hydrates story/state files into **that root's** slice via `pushRoot(root, …)`.
4. Registers the two `watch_directory` channels whose `onmessage` calls `reconcileState(root, evt.path)` / `reconcileStory(root, evt.path)` — capturing `root` in the closure so background projects update their own slice.

- [ ] **Step 4: Add `setActiveProject` and `closeProject`**

```ts
setActiveProject: (root) => { set({ activeRoot: root }); syncMirror(); },
closeProject: (root) => {
  set((s) => {
    const projects = { ...s.projects };
    delete projects[root];
    const roots = Object.keys(projects);
    const activeRoot = s.activeRoot === root ? (roots[roots.length - 1] ?? null) : s.activeRoot;
    return { projects, activeRoot };
  });
  syncMirror();
},
```
(Note: closing does not stop the Rust engine entry or PTYs — that's fine; a re-open re-registers watchers. Leaving the engine entry is harmless.)

- [ ] **Step 5: `setStatus` writes the active slice by root**

`setStatus` stays the same but pushes via `pushRoot(get().activeRoot!, applyStatus(get().projects[get().activeRoot!].board, …))` and invokes with `{ root: get().activeRoot, … }`.

- [ ] **Step 6: Typecheck + tests + manual init check**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: TS clean, 139 pass. The mirror keeps every `useBmadStore(s => s.stories)` call site working.

- [ ] **Step 7: Commit**

```bash
git add src/stores/bmadStore.ts
git commit -m "feat(stores): bmadStore per-project slices with active mirror"
```

---

## Phase 3 — useCadre per-project slices + captured-root routing

### Task 5: useCadre namespaces mutable fleet state by root

**Files:**
- Modify: `src/cadre/useCadre.ts` (state shape + `set` sites)

**Interfaces:**
- Consumes: `updateSlice` (Task 3).
- Produces: `CadreSlice` = the currently-per-project fields: `phase, prd, architecture, analystBrief, techDocs, uxSpec, mockupHtml, poValidation, projectContext, isBrownfield, detectedVerify, verification, needsReplan, logs, codeReviews, active`. State gains `projects: Record<string, CadreSlice>` + `activeRoot`; keeps those fields as the mirror. `busy`/`error`/`fleetProvider` stay global (UI-level, not per-project — acceptable for v1; document it).

- [ ] **Step 1: Define `CadreSlice` + `emptyCadreSlice()` in `projectSlices.ts`**

Add:

```ts
export interface CadreSlice {
  phase: Phase; prd: string; architecture: string; analystBrief: string; techDocs: string;
  uxSpec: string; mockupHtml: string; poValidation: string; projectContext: string;
  isBrownfield: boolean; detectedVerify: string; verification: string[]; needsReplan: boolean;
  logs: Record<string, string>;
  codeReviews: Record<string, { status: "reviewing" | "done"; reviews?: LensReview[] }>;
  active: Record<string, boolean>;
}
export function emptyCadreSlice(): CadreSlice { /* all fields at their current defaults */ }
export function mirrorCadre(projects: Record<string, CadreSlice>, activeRoot: string | null): CadreSlice { … }
```

(Import `Phase` from `../../cadre/components/PhaseStepper` and `LensReview` from `./reviewFleet`. Move these types if a cycle appears; keep the slice type colocated with the mirror.)

- [ ] **Step 2: Add a `syncCadreMirror` + `patchRoot(root, patch)` helper in useCadre**

```ts
function syncCadreMirror() { set((s) => mirrorCadre(s.projects, s.activeRoot)); }
// Apply a patch to a SPECIFIC root's slice, then mirror if it's active.
function patchRoot(root: string, patch: Partial<CadreSlice>) {
  set((s) => ({ projects: updateSlice(s.projects, root, patch, emptyCadreSlice) }));
  if (get().activeRoot === root) syncCadreMirror();
}
```

- [ ] **Step 3: Route every per-project `set` through `patchRoot`**

Mechanical transform: every `set({ phase: X })` / `set(s => ({ logs: {...} }))` etc. that mutates a per-project field becomes `patchRoot(root, { … })` with the appropriate `root`:
- Simple setters (`setPhase`, `setPrd`, …) use `get().activeRoot` (they only ever edit the foreground project).
- **Dispatch/review closures (`dispatchStory`, `dispatchReady`, `reviewStory`, `documentProject`)** use the `root` variable ALREADY captured at the top of the action (`const root = requireRoot()`), NOT `get().activeRoot`. This is the invariant: a background dispatch's `onOutput`, `logSession`, status write, and `codeReviews`/`active` updates all target the captured root.

Concretely in `dispatchStory`, the streaming `onOutput` becomes:

```ts
const onOutput = (chunk: string) => {
  aiLog(key, chunk);
  patchRoot(root, {
    logs: { ...(get().projects[root]?.logs ?? {}), [key]: capChunk((get().projects[root]?.logs?.[key] ?? "") + chunk) },
  });
};
```

And `set((s) => ({ active: … }))` / `codeReviews` writes become `patchRoot(root, { active: … })`.

- [ ] **Step 4: `hydrateFromProject` writes a specific root's slice**

`hydrateFromProject` currently sets top-level fields; change it to accept/capture `root = requireRoot()` and call `patchRoot(root, { prd, architecture, phase, … })`.

- [ ] **Step 5: Add `setActiveProject(root)` to useCadre, wired from CadreApp**

```ts
setActiveProject: (root) => { set({ activeRoot: root }); syncCadreMirror(); },
```

- [ ] **Step 6: Typecheck + tests**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: TS clean, 139 pass. No store logic is unit-tested directly, so the mirror keeps behavior identical for a single active project.

- [ ] **Step 7: Commit**

```bash
git add src/cadre/useCadre.ts src/lib/engine/projectSlices.ts
git commit -m "feat(stores): useCadre per-project slices; dispatch writes by captured root"
```

---

## Phase 4 — Tab bar UI + persistence + wiring

### Task 6: openProjectsStore (the tab list) with persistence

**Files:**
- Create: `src/stores/openProjectsStore.ts`
- Test: `src/stores/openProjectsStore.test.ts`

**Interfaces:**
- Produces: `useOpenProjects` with `roots: string[]`, `activeRoot: string | null`, `open(root, name)`, `close(root)`, `setActive(root)`, `names: Record<string, string>`. Persists `roots + activeRoot + names` to `localStorage["cadre-open-projects"]`. Pure list ops (`addRoot`, `removeRoot`) are unit-tested.

- [ ] **Step 1: Write the failing test for the pure list ops**

```ts
import { describe, it, expect } from "vitest";
import { addRoot, removeRoot } from "./openProjectsStore";

describe("open-projects list ops", () => {
  it("addRoot appends unique and keeps order", () => {
    expect(addRoot(["/a"], "/b")).toEqual(["/a", "/b"]);
    expect(addRoot(["/a", "/b"], "/a")).toEqual(["/a", "/b"]);
  });
  it("removeRoot drops and picks a neighbor as next active", () => {
    const { roots, next } = removeRoot(["/a", "/b", "/c"], "/b", "/b");
    expect(roots).toEqual(["/a", "/c"]);
    expect(next).toBe("/c");
  });
  it("removeRoot keeps active when a different tab is closed", () => {
    const { next } = removeRoot(["/a", "/b"], "/a", "/b");
    expect(next).toBe("/b");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run src/stores/openProjectsStore.test.ts
```

- [ ] **Step 3: Implement the store + pure ops**

```ts
import { create } from "zustand";

const KEY = "cadre-open-projects";

export function addRoot(roots: string[], root: string): string[] {
  return roots.includes(root) ? roots : [...roots, root];
}
export function removeRoot(roots: string[], root: string, active: string | null) {
  const idx = roots.indexOf(root);
  const next = roots.filter((r) => r !== root);
  const nextActive = active === root ? (next[Math.min(idx, next.length - 1)] ?? null) : active;
  return { roots: next, next: nextActive };
}

interface Persisted { roots: string[]; activeRoot: string | null; names: Record<string, string> }
function load(): Persisted {
  try { return { roots: [], activeRoot: null, names: {}, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; }
  catch { return { roots: [], activeRoot: null, names: {} }; }
}
function persist(p: Persisted) { localStorage.setItem(KEY, JSON.stringify(p)); }

interface OpenProjectsState extends Persisted {
  open: (root: string, name: string) => void;
  close: (root: string) => void;
  setActive: (root: string) => void;
}
export const useOpenProjects = create<OpenProjectsState>((set, get) => ({
  ...load(),
  open: (root, name) => {
    set((s) => { const roots = addRoot(s.roots, root); const names = { ...s.names, [root]: name };
      const st = { roots, activeRoot: root, names }; persist(st); return st; });
  },
  close: (root) => {
    set((s) => { const { roots, next } = removeRoot(s.roots, root, s.activeRoot);
      const names = { ...s.names }; delete names[root];
      const st = { roots, activeRoot: next, names }; persist(st); return st; });
  },
  setActive: (root) => set((s) => { const st = { ...s, activeRoot: root }; persist(st); return st; }),
}));
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx vitest run src/stores/openProjectsStore.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/stores/openProjectsStore.ts src/stores/openProjectsStore.test.ts
git commit -m "feat(stores): open-projects tab list with localStorage persistence"
```

### Task 7: ProjectTabs UI + CadreApp wiring + restore on launch

**Files:**
- Create: `src/cadre/ProjectTabs.tsx`
- Modify: `src/cadre/CadreApp.tsx`

**Interfaces:**
- Consumes: `useOpenProjects` (Task 6), `useBmadStore.openProject/closeProject/setActiveProject` (Tasks 2/4), `useCadre.setActiveProject` (Task 5).
- Produces: a horizontal tab strip above the phase bar; a `+` button that opens the folder dialog (reusing `Welcome`'s open path) and calls `openProject`. Switching a tab calls `setActiveProject` on BOTH stores + `useOpenProjects.setActive`.

- [ ] **Step 1: Build `ProjectTabs.tsx`**

A row of tabs from `useOpenProjects().roots` (label = `names[root] ?? basename(root)`), an active highlight, a per-tab close ×, and a `+` new/open button. `onSelect(root)`:

```ts
function selectProject(root: string) {
  useOpenProjects.getState().setActive(root);
  useBmadStore.getState().setActiveProject(root);
  useCadre.getState().setActiveProject(root);
}
```

`onClose(root)` calls `useBmadStore.getState().closeProject(root)`, `useOpenProjects.getState().close(root)`, then selects the new active root (if any). `+` triggers the same folder-open flow `Welcome` uses (`open` dialog → `openProject(path)` → `useOpenProjects.open(path, basename(path))`).

- [ ] **Step 2: Mount `ProjectTabs` in CadreApp above the phase stepper**

Render `<ProjectTabs />` at the top of the main chrome (only when `projectRoot` is set). Keep the existing `Welcome` gate for the zero-projects case; when the user opens their first project, push it into `useOpenProjects`.

- [ ] **Step 3: Restore open tabs on launch**

In CadreApp's mount effect, read `useOpenProjects.getState().roots`; for each, call `useBmadStore.getState().openProject(root)` (this registers watchers + engine entry per project), then `setActiveProject(activeRoot ?? roots[0])` on both stores. Guard against double-open with a ref.

- [ ] **Step 4: Typecheck + tests + smoke**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: TS clean, all tests pass (146 total: +3 projectSlices, +3 openProjects, +1 was already counted — verify the number and adjust).

- [ ] **Step 5: Manual verification (document, since GUI isn't unit-tested)**

Build and run the app. Open project A, dispatch a story, switch to project B while A builds, confirm: (a) B shows its own board, (b) A's story reaches Done/Failed while B is foreground (watch the AI log — A's entries keep flowing), (c) switching back to A shows the completed status, (d) relaunch restores both tabs.

- [ ] **Step 6: Commit**

```bash
git add src/cadre/ProjectTabs.tsx src/cadre/CadreApp.tsx
git commit -m "feat(ui): project tab bar — open, switch, close, restore on launch"
```

---

## Self-Review

**Spec coverage:**
- Open multiple projects as tabs → Task 6 (list) + Task 7 (UI). ✓
- Each project live simultaneously → Task 1 (engine keyed by root) + Task 4/5 (per-root slices, captured-root routing). ✓
- Instant switch (no reload) → Task 4/5 mirror swap on `setActiveProject`; no re-hydrate on switch. ✓
- Persist open tabs + active across restarts → Task 6 (localStorage) + Task 7 Step 3 (restore). ✓
- Preserve 139 tests → every task ends on green; mirror keeps selectors working. ✓
- Rust commands take root → Task 1. ✓
- bmadStore/useCadre per-project slices + mirror → Tasks 4/5. ✓
- Background dispatch writes captured root → Task 5 Step 3 (the invariant). ✓

**Known v1 limitations (documented, not gaps):**
- `busy`/`error`/`fleetProvider` in useCadre stay global (foreground-only). If two projects both need a spinner at once, only the foreground shows it. Acceptable; revisit if needed.
- Closing a tab leaves the Rust engine entry + any running PTYs alive (harmless; re-open re-registers watchers). A future task can add explicit teardown.
- `aiLog` remains a single global stream (already tagged by story key); it shows all projects interleaved. Fine for a diagnostic log.

**Type consistency:** `BmadSlice`/`CadreSlice`/`mirrorBmad`/`mirrorCadre`/`updateSlice`/`emptyBmadSlice`/`emptyCadreSlice`/`patchRoot`/`pushRoot`/`syncMirror` names are used identically across Tasks 3–5. Engine command arg name is `root` everywhere (Rust + `invoke`). `setActiveProject(root)` exists on both stores.

**Placeholder scan:** none — `emptyCadreSlice()` body is "all fields at their current defaults" which is a mechanical copy of useCadre's existing initial values (phase `"PLAN"`, empty strings, `[]`, `{}`, `false`), stated explicitly.
