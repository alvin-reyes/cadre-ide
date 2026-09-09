# Project-Scoped Maintain Cockpit (Design)

**Date:** 2026-09-10
**Status:** Approved for planning
**Scope:** Switching project tabs must stop killing the Maintain cockpit's `claude`
session. One cockpit instance per open project, all mounted, visibility-toggled.
Terminal/PTY lifetime only — no change to fleet dispatch, verification, or the state machine.

## Problem

Clicking another project tab kills the Maintain terminal and the `claude` process
running inside it. Switching back gives you a **fresh** session below the restored
scrollback, which reads as "the terminal restarted".

Three independent teardowns fire on a single project switch:

| # | Site | Mechanism |
|---|---|---|
| 1 | `MaintainMainTabs.tsx:84` | `<TerminalTabs key={projectRoot} …>` — a changed React `key` unmounts the subtree |
| 2 | `CadreApp.tsx:96` | `setMaintainMounted(mode === "maintain")` unmounts the whole cockpit if the incoming project is in Build mode |
| 3 | `CadreApp.tsx:249`, `:87` | the dock terminal is keyed the same way, and `setTermMounted()` drops it unless the new project's saved view was `terminal` |

Each unmount reaches `TerminalPanel`'s cleanup, which calls `kill_pty`
(`TerminalPanel.tsx:221`). That drops the `PtyInstance`, closing the master and taking
the login shell — and `claude` with it — down.

All three are deliberate. `CadreApp.tsx:79-81` states the intent: *"so a project switch
doesn't leak the previous project's Claude terminal into the newly-active one"*. The
cockpit is a **singleton re-pointed at the active project**, and destroying it is how it
avoids cross-project leakage.

Project tabs invalidate that assumption. The entire point of a tab strip is that
switching away and back preserves what you had. Destroying the session is a correct fix
for leakage and the wrong fix for tabs.

## Why the obvious cheap fixes don't work

- **Dropping `key={projectRoot}`.** The key is what currently prevents project A's
  terminal from being reused for project B. Remove it and you get the leak the comment
  warns about — worse than the bug.
- **Not killing the PTY on unmount.** Leaks a PTY per switch with no owner and no reaper.
  (Keeping PTYs in the Rust registry and reattaching via the existing `reattach_pty` is a
  coherent alternative design; it was considered and rejected for this slice as a larger
  change spanning Rust + TS with an unresolved "who kills them, and when?".)

## Decisions settled

1. **One cockpit per open project root**, all mounted, only the active one visible —
   the same `hidden()` visibility pattern `CadreApp` already uses for view switching and
   for Build⇄Maintain. No Rust changes.
2. **Mounted set is the open-projects roots**, not "every project ever seen". Closing a
   project tab unmounts its cockpit and *should* kill its PTY — that is the one place
   teardown is correct.
3. **Root-scoped reads and writes.** A mounted-but-hidden cockpit must never mutate the
   active project. This is the load-bearing constraint (see below).
4. **Lazy per root.** A project's cockpit mounts the first time that project enters
   Maintain mode, not on app launch — so opening five Build projects spawns no terminals.
5. **The dock terminal gets the same treatment** (`CadreApp.tsx:249`), for the same
   reason. Both surfaces already namespace their persistence by root
   (`maintain:<root>` / `dock:<root>`), so scrollback restore needs no change.

## The load-bearing constraint

The store is **already fully per-project**. `CadreSlice` carries `mode`, `stagedTasks`,
and `batches` per root (`projectSlices.ts:63-99`), every mutator takes a root and calls
`patchRoot(root, …)` (`useCadre.ts:550-590`), and `mirrorCadre` merely exposes the active
project's slice as top-level fields.

The components are what assume a singleton:

| Site | Reads | Problem when N are mounted |
|---|---|---|
| `MaintainMainTabs.tsx:16` | `useCadre((s) => s.batches)` | the **mirror** — every cockpit shows the active project's batches |
| `IntakeRail.tsx:15` | `useCadre((s) => s.stagedTasks)` | same |
| `MaintainView.tsx:16` | `useBmadStore((s) => s.projectRoot)` | same |
| `useCadre.ts:570-590` | `closeBatch(batchId)` etc. resolve `root` via `get().activeRoot` / `requireRoot()` | a hidden cockpit's action **mutates the wrong project** |

So the change is: components take an explicit `root` prop, select from
`s.projects[root]`, and call actions with an explicit root. This is wiring, not new
state — the store already models what we need.

### Action signatures

Maintain actions gain an optional trailing `root`, defaulting to the current
active-root behaviour so existing callers (and the CLI face) are untouched:

```ts
closeBatch: (batchId: string, root?: string) => void;
closeSubagent: (batchId: string, taskId: string, root?: string) => void;
markSubagentExited: (batchId: string, taskId: string, root?: string) => void;
reorderSubagent: (batchId: string, from: string, to: string, root?: string) => void;
stageTask: (prompt: string, root?: string) => void;
unstageTask: (id: string, root?: string) => void;
runStagedBatch: (root?: string) => Promise<string | null>;
```

This mirrors `bmadStore.setStatus`, which already takes
`root: string | undefined | null = get().activeRoot` — an established pattern in this
codebase rather than a new one.

## Architecture

### Pure core (`src/lib/maintain/mountedCockpits.ts`)

Vitest is node-only over `src/**/*.test.ts` with no DOM, so the mount-set policy lives
outside the component or it cannot be tested:

```ts
/** Roots whose cockpit should stay mounted: previously-mounted ∩ still-open, plus
 *  the active root when it is in Maintain mode. Order is stable for React keys. */
export function nextMountedRoots(input: {
  mounted: string[];
  openRoots: string[];
  activeRoot: string | null;
  activeMode: ProjectMode;
}): string[];
```

Pure, total, and the whole lazy-mount + close-project-unmounts rule in one testable
function.

### Component wiring (`CadreApp.tsx`)

```jsx
{mountedCockpits.map((root) => (
  <div key={root} style={hidden(mode === "maintain" && root === projectRoot)}>
    <MaintainView root={root} />
  </div>
))}
```

`MaintainView` takes `root` as a prop instead of reading the store;
`MaintainMainTabs`, `IntakeRail`, `FleetTab`, and `ThoughtsDock` thread it down.
`ThoughtsDock` already takes `projectRoot` + `surfaceId`, so it needs no signature change.

`maintainMounted: boolean` is replaced by `mountedCockpits: string[]`; the
`[projectRoot]` effect at `CadreApp.tsx:82-97` stops resetting it and instead recomputes
via `nextMountedRoots`.

## Data flow

1. User clicks project tab B → `selectProject` → `setActiveProject` on three stores
   (`ProjectTabs.tsx:21-23`) → `syncMirror` → `projectRoot` mirror changes.
2. `nextMountedRoots` adds B if B is in Maintain mode; A stays in the list.
3. React re-renders: A's cockpit keeps its `key={A}` (**no unmount, PTY survives**),
   B's mounts or reveals.
4. `hidden()` shows B, hides A. A's `claude` keeps running.
5. Closing project A's tab removes A from `openRoots` → `nextMountedRoots` drops it →
   A's cockpit unmounts → `kill_pty` → PTY reaped. Correct teardown, only here.

## Safety / invariants

- **No cross-project writes.** Every cockpit reads `s.projects[root]` and calls actions
  with its own root. A hidden cockpit cannot touch the active project.
- **PTYs die exactly once, on project close.** Not on tab switch, view switch, or
  mode toggle.
- **No new Rust surface.** `kill_pty` / `create_pty` / `reattach_pty` are untouched;
  the state machine and verification gate are not involved.
- **Resource ceiling is user-visible and bounded by open project tabs.** N open Maintain
  projects = N PTYs = N `claude` sessions. That is the accepted cost of the chosen
  option, and it is bounded by something the user controls directly.

## Testing

Per repo convention — logic in a pure module, UI behaviour in demo-mode scripts.

- `src/lib/maintain/mountedCockpits.test.ts` — lazy add on entering Maintain; no add for
  a Build project; close-project removes; active-root switch preserves both; stable order;
  idempotent.
- `src/cadre/useCadre.test.ts` (extend) — each root-taking action mutates the named root
  and leaves the active root untouched when they differ; omitting `root` preserves the
  existing active-root behaviour.
- Playwright demo script — open two projects in Maintain mode, note terminal A's pty id,
  switch to B and back, assert **no** `[process exited: …]` line and the same pty id.
  This is the regression test for the actual reported bug.

## Non-goals (this slice)

- Rust-side PTY persistence / `reattach_pty` (the rejected alternative).
- Any change to fleet dispatch, worktrees, verification, or `cadre_state.rs`.
- Restoring live sessions across an app relaunch — a quit still kills PTYs, and each pane
  still re-runs its startup command beneath restored scrollback.
- Capping how many cockpits may be mounted at once. Revisit if N gets painful in practice.

## Follow-up

The temporary PTY exit-reason instrumentation added while diagnosing this
(`reason=killed|eof|read-error`, pid, uptime in `pty.rs` + `TerminalPanel.tsx`, plus
`[cadre:pty]` console lines) should either be reverted or promoted to a proper
`reportError` surface per the toast-plus-AI-Log convention. Its Rust half — the `killed`
set that lets an app-initiated kill be told apart from a child dying on its own — is
genuinely useful and worth keeping regardless.
