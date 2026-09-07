# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Cadre** — a Tauri v2 (Rust) + React 19 + TypeScript desktop IDE that runs a disciplined fleet of
Claude Code agents. The load-bearing invariant, which most of the architecture exists to protect:

> **The engine runs the verification command itself and writes `Done`. Agents never self-report success.**

`docs/agentic-os.md` is the architecture map (OS-layer framing: kernel, processes, policy,
observability) and is the best single file to read before making structural changes.

## Commands

```bash
npm install
npm run tauri dev            # run the desktop app
npm run tauri build          # production build

npm run test                 # vitest run — the main suite (81 test files)
npx vitest run src/lib/engine/verifyStory.test.ts     # a single file
npx vitest run -t "writes Done"                       # a single test by name
npm run test:watch

cd src-tauri && cargo test   # Rust: state machine, verify, secrets, pty

npm run build                # tsc (typecheck ALL of src) + vite build
npm run cadre:build          # compile the CLI only → dist-cli/
npm run cadre -- status .    # build + run the CLI

npm run test:smoke           # playwright, browser demo mode; needs `npx playwright install chromium`
npm run test:e2e             # full plan→shard→execute→Done lifecycle in demo mode
npm run test:e2e:extensive
```

`tsconfig.json` sets `strict`, `noUnusedLocals`, and `noUnusedParameters` — an unused import fails
`npm run build`, not just lint.

## Architecture

### One kernel, two faces

All lifecycle logic lives in `src/lib/engine/` as **pure functions over injected dependency
interfaces** (`DispatchDeps`, `VerifyDeps`, `RunStoryDeps`, `ReviewFleetDeps`, `IntegrateDeps`,
`OrchestratorDeps`). Two thin adapters wire those same interfaces to a runtime:

- `src/lib/engine/tauriDeps.ts` → Tauri `invoke()` (the desktop app)
- `src/cli/nodeDeps.ts` → Node `child_process` / `fs` (the headless `cadre` CLI)

**Never put lifecycle logic in a component, a store, or the CLI.** Add it to `src/lib/engine/` behind
a deps interface so both faces get it and it stays unit-testable. `src/cli/cadre.ts` mirrors
`useCadre.dispatchStory`'s control flow deliberately — changes to one usually need the other.

### The authoritative state machine (Rust)

`src-tauri/src/cadre_state.rs` owns story status: `Draft → Approved → InProgress → InReview →
Done | Failed | Blocked`. `legal_next()` there is mirrored by `src/lib/engine/transitions.ts` and
`src/lib/engine/status.ts` — **change all three together or the faces diverge.**

`CadreState` is the *sole writer* of `.cadre/state/`, `.cadre/approvals/`, and `.cadre/decisions/`.
Agents run in worktrees with no write path to them, which is why status can't be forged. It also
records a hash of each file it writes so the filesystem watcher ignores cadre's own writes
("write-origin suppression") — without that, engine writes echo back as spurious transitions.

`.cadre/approvals/plan.json` freezes the human-confirmed verification command(s) at the approval
gate. The QA gate re-reads it from disk (`verify.rs::run_command`, own process group so a timeout
kills the whole test-runner tree) — an agent can never set what it will be judged against.

### Isolation

Every unit of work gets its own git worktree on its own branch: `story/<epic>.<story>` for Build
mode (`src/lib/engine/dispatch.ts`), `task/<id>` for Maintain mode
(`src/lib/maintain/runBatch.ts`), both under `.cadre/worktrees/` (stories nest by repo id —
see `repoWorktreePath` in `src/lib/engine/repos.ts` — because a project can span several repos).
Concurrent `git worktree add` on
one repo races on git's locks — batch creation must be serialized. Merges back to main are
serialized too; a conflict marks the story `Blocked` rather than clobbering.

### Frontend

`src/main.tsx` → `src/cadre/CadreApp.tsx`. State is Zustand (`src/stores/`), with
`src/cadre/useCadre.ts` (~1500 lines) as the orchestration hub that composes the engine with the
stores. Two project modes, remembered per project root in localStorage
(`src/lib/maintain/modePreference.ts`): **Build** (plan → shard → fleet → done) and **Maintain**
(the staged-tasks → fleet-run cockpit under `src/cadre/maintain/` + `src/lib/maintain/`).

**Legacy code:** `src/App.tsx`, `src/DetachedApp.tsx`, `src/components/` (except
`components/editor/MonacoWrapper`), `src/hooks/`, and `src/data/` are the older ADE terminal IDE and
are **not reachable from `main.tsx`**. `CONTRIBUTING.md` still describes that older app. Don't extend
them; new UI goes under `src/cadre/`.

### Testing conventions

Vitest runs in the **node** environment over `src/**/*.test.ts` only — there are no `.test.tsx`
files and no DOM. This is a forcing function: extract logic into a pure, dependency-injected module
in `src/lib/` and test that; UI behavior is covered by the Playwright demo scripts in `scripts/`.

Those scripts drive **demo mode** (`src/lib/demo/`): `?demo=1` boots a pre-planned project on the
Execute board, `?demo=plan` a bare greenfield project on the Plan phase, both against a mock Tauri
backend and mock Anthropic client. Demo mode must keep working — it is the only automated coverage
of the real UI.

## Conventions

- **Errors are never silent.** Every failure surfaces as a toast *and* a persistent AI Log entry —
  use `reportError()` from `src/lib/reportError.ts`.
- **Secrets** go through the OS keychain (`src-tauri/src/secrets.rs`, `src/lib/secrets.ts`), never
  into `.cadre/` files, MCP config files, or command lines. Agent env injection is the only path.
- **Commits** are conventional with a scope: `feat(mcp):`, `fix(cli):`, `refactor(mcp):`,
  `test(mcp):`, `docs(mcp):`.
- **Feature work is spec-first.** A design doc lands in `docs/superpowers/specs/`
  (`YYYY-MM-DD-<slice>-design.md`) and an implementation plan in `docs/superpowers/plans/`, both
  committed before the code. Follow that for any non-trivial slice.
- Comments here explain *why* an invariant exists (the race, the forged-status hole, the lock
  contention) rather than what the code does. Match that density and register.

## Other agent configs

A Gemini CLI config exists at `~/.gemini/settings.json`. To bring anything importable from it
(MCP servers, commands, subagents, skills, instructions) into Claude Code, reply `/import` to scan
and list what's importable, then `/import --yes=<digest>` (the scan output names the digest) to
apply the user-level items. If `/import` isn't available on this surface, run `claude import` from a
terminal instead.
