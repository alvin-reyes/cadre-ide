# Web Demo Mode + Mock Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A browser-only **Demo mode** that makes every screen fully interactive without the Tauri desktop app or a real `claude` CLI/API — a mock Tauri backend, a mock build agent that streams output and drives stories to Done, and a mock Anthropic planning layer so the PM→Architect→shard→execute flow works end-to-end. Doubles as a try-before-install web demo.

**Architecture:** `isTauri()` is just `"__TAURI_INTERNALS__" in window`, and Tauri's `invoke`/`Channel` route through that object. Demo mode installs a mock `window.__TAURI_INTERNALS__` so ALL existing `invoke(...)` calls (23 files, unchanged) hit an in-memory backend. Agent output streams by calling the live `Channel`'s `onmessage` directly. Planning is mocked at the single `makeAnthropic()` seam. Everything is gated behind an explicit demo entry — production/Tauri behavior is untouched.

**Tech Stack:** React 19 + TS, Zustand, Vitest.

## Global Constraints

- Preserve all 420 frontend tests + Rust green. Demo code is NEW + gated — the non-demo (Tauri) path must be byte-identical.
- The mock is installed ONLY when demo mode is explicitly entered in a browser (never under real Tauri — guard on the real `__TAURI_INTERNALS__` being absent before installing).
- Faithful to the real command surface: the mock implements the exact `invoke` command names + arg shapes the app uses, and the exact `PtyEvent`/`Channel` protocol, so the REAL app pipeline runs against it.
- No secrets, no network. Errors surface via `reportError`.

## Key mechanism (verified against @tauri-apps/api 2.10.1)

- `window.__TAURI_INTERNALS__` must provide: `invoke(cmd, args, options) => Promise`, `transformCallback(cb, once) => number` (return an incrementing id, store cb), `unregisterCallback(id) => void`, `convertFileSrc(path) => path`.
- A `Channel` passed in `invoke` args arrives in the mock as the **live Channel instance**. Stream events by calling `args.onEvent.onmessage({ type: "output", data })` (data = `number[]` of UTF-8 bytes, per `decodePtyData`) and end with `{ type: "exit", code: 0 }`.
- The mock `invoke` returns a Promise resolving to the command's normal return value.

---

## File Structure
- `src/lib/demo/mockFs.ts` *(new)* — in-memory filesystem (Map<path,string>) + list/read/write/mkdir helpers. Unit-tested.
- `src/lib/demo/mockBackend.ts` *(new)* — the `invoke` command dispatcher (file/git/state/verify/secrets/misc) + the mock agent (pty/channel) + `installMockBackend()` that sets `window.__TAURI_INTERNALS__`.
- `src/lib/demo/mockAnthropic.ts` *(new)* — a fake Anthropic client returned by `makeAnthropic` in demo mode (scripted `messages.stream`/`messages.create` with canned artifacts + tool calls).
- `src/lib/demo/demoContent.ts` *(new)* — the canned demo data: project name, PRD/architecture/ux, backlog of stories, agent build transcripts, review verdicts.
- `src/lib/demo/demoMode.ts` *(new)* — `isDemoMode()` + `enterDemoMode()` (install backend, seed the project) + a small flag store.
- `src/lib/planning/planningChat.ts` — `makeAnthropic` returns the mock client when `isDemoMode()`.
- `src/main.tsx` / `src/cadre/SignIn.tsx` (or `Welcome.tsx`) — a "Try the demo" entry (and `?demo=1` support).

---

## Task 1: Mock filesystem + core Tauri command backend

**Files:** `src/lib/demo/mockFs.ts` (+ test), `src/lib/demo/mockBackend.ts` (the non-agent commands + install), `src/lib/demo/demoMode.ts`.

- [ ] **Step 1: `mockFs.ts`** — an in-memory FS: `class MockFs` (or a factory) with `read(path):string|null`, `write(path,content)`, `exists(path)`, `mkdir(path)`, `list(dir): {name,path,is_dir}[]` (derive dirs/files from the key set), `remove(path)`. Seeded from an initial `Record<path,content>`. Unit-test list/read/write/dir-derivation.
- [ ] **Step 2: `installMockBackend(fs)`** in `mockBackend.ts` — set `window.__TAURI_INTERNALS__ = { invoke, transformCallback, unregisterCallback, convertFileSrc }`. GUARD: if a real `__TAURI_INTERNALS__` already exists (real Tauri) OR not in a browser, do nothing. `transformCallback` returns an incrementing id and stores the cb in a Map; `unregisterCallback` deletes it; `convertFileSrc` returns the path unchanged.
- [ ] **Step 3: command dispatcher** (`invoke(cmd, args)` switch) implementing the NON-agent, NON-plugin commands the app calls (grep the codebase for `invoke("`): 
  - FS: `read_file`→fs.read (throw if missing, matching real behavior callers `.catch`), `read_file_base64`, `write_text_file`→fs.write (create parent dirs), `create_directory`, `list_directory`→fs.list, `list_md_files`, `save_temp_image`→return a fake path.
  - Project/state: `open_project`→ok, `story_set_status`/`story_get_status`/`is_own_write` → drive the state machine using the existing `src/lib/engine/transitions.ts` + writing `.cadre/state/{e}.{s}.json` in the mock FS; `approve_plan`/`get_plan_approval` → store/return a `PlanApproval` (reuse `src/lib/engine/planApproval.ts`).
  - Exec: `run_git`→`{ exit_code:0, stdout:"", stderr:"", timed_out:false }`; `run_verification`→`{ exit_code:0, stdout:"mock: all tests passed", stderr:"", timed_out:false }`; `run_gh`→`{ exit_code:0, stdout:'{"number":1}', stderr:"", timed_out:false }`.
  - Secrets: `secret_get`→null, `secret_set`/`secret_delete`→ok, `secret_has`→false (or back them with an in-memory map so Settings works).
  - Env/probes: `check_command_exists`→true, `check_claude_plugin`→true, `claude_auth_status`→true, `get_pty_cwd`→the cwd.
  - Watchers: `watch_directory`/`unwatch_directory`→no-op (the demo drives state directly; no fs events needed).
  - Dialog plugin: `plugin:dialog|open` → return the seeded demo project path (so "Open project"/"browse" works).
  - Any unmapped command: `console.warn("[demo] unhandled invoke:", cmd)` and resolve `null` (so a miss degrades, never hangs).
- [ ] **Step 4: `demoMode.ts`** — `isDemoMode()` (reads a module flag / `?demo=1` / localStorage `cadre-demo`), and a stub `enterDemoMode()` (completed in Task 4). 
- [ ] **Step 5: Tests** — `mockFs.test.ts` (FS ops), and a `mockBackend.test.ts` for the pure command handlers that don't need the DOM (`run_verification` shape, `story_set_status` transition via transitions.ts, `list_directory` from seeded FS). The `installMockBackend` DOM glue need not be unit-tested.
- [ ] **Step 6: Verify** `npx tsc --noEmit && npx vitest run` green (420 + new). **Commit** — `feat(demo): in-memory FS + mock Tauri command backend`

## Task 2: The mock build agent (PTY/Channel streaming)

**Files:** `src/lib/demo/mockBackend.ts` (the pty commands), `src/lib/demo/demoContent.ts` (transcripts).

- [ ] **Step 1: transcripts** in `demoContent.ts` — `buildTranscript(storyTitle): string[]` returns a handful of realistic lines an agent would print (reading the story, writing a test, running it, implementing, committing). Keep it short (6–12 lines).
- [ ] **Step 2: `create_pty`** handler — grab `const ch = args.onEvent` (the live Channel). Immediately return a fresh numeric ptyId. Then, on timers (e.g. a line every ~250–400ms), call `ch.onmessage({ type: "output", data: Array.from(new TextEncoder().encode(line + "\n")) })` for each transcript line; after the last, `ch.onmessage({ type: "exit", code: 0 })`. Track the timer per ptyId so `kill_pty` can cancel it. The transcript can be derived from the command/cwd (parse the story id from the worktree path) or a generic one.
- [ ] **Step 3: `write_pty`/`resize_pty`/`reattach_pty`/`kill_pty`** — `kill_pty` clears the pty's timers and (if still running) emits `{ type: "exit", code: 143 }`; the others are no-ops that resolve.
- [ ] **Step 4: Manual-ish check via a unit test where possible** — extract the transcript-emission scheduling into a testable helper if clean (e.g. `streamTranscript(onEvent, lines, tick)` with an injected timer), and test that it emits N output events then one exit. The `create_pty` glue itself is validated in Task 4's smoke.
- [ ] **Step 5: Verify** tsc + vitest green. **Commit** — `feat(demo): mock build agent — streams a transcript then exits 0`

## Task 3: Mock Anthropic planning layer

**Files:** `src/lib/demo/mockAnthropic.ts` (+ test), `src/lib/planning/planningChat.ts` (route `makeAnthropic` to the mock in demo mode), `src/lib/demo/demoContent.ts` (planning artifacts).

- [ ] **Step 1: study the real client usage** — `makeAnthropic` (planningChat.ts:10) is used at :183 (`client.messages.stream(...)`) and :276 (`client.messages.create(...)`). Read both call sites + any other `makeAnthropic` consumer (orchestrator copilot, SDK adversarial reviews) to learn the exact stream/message interface used (`.on(...)`/async-iter, `.finalMessage()`, the `content` blocks incl. `tool_use`). The mock must satisfy that interface.
- [ ] **Step 2: `mockAnthropic.ts`** — export `makeMockAnthropic(): Pick<Anthropic, "messages">`-shaped object whose `messages.stream(params)` returns a fake `MessageStream` and `messages.create(params)` returns a `Promise<Message>`. It inspects `params` (the system prompt / tools offered) to decide a canned response:
  - A PM/architect/designer/techwriter/devops turn (has `write_document` tool) → stream a short assistant sentence, then a `tool_use` for `write_document` carrying the matching canned artifact from `demoContent` (PRD/architecture/ux/docs/ops), and finalize.
  - An SM `create_story`/`create_backlog` turn → a `tool_use` producing the canned backlog/story.
  - A `handoff`/`suggest_replies` turn → the appropriate tool_use.
  - An adversarial review (`messages.create`) → a canned "approve, no blocking issues" verdict in the expected shape.
  - Default → a short plain-text reply.
  - Keep replies SHORT; the point is a coherent, deterministic flow, not realism.
- [ ] **Step 3: route it** — in `planningChat.ts` `makeAnthropic`, `if (isDemoMode()) return makeMockAnthropic() as unknown as Anthropic;` at the top (guard so the real path is untouched otherwise). Confirm this covers every SDK construction site (if the orchestrator copilot builds its own client elsewhere, route that too).
- [ ] **Step 4: Tests** — `mockAnthropic.test.ts`: `messages.stream` for a write_document turn yields a tool_use with the right doc; `messages.create` for a review returns an approve verdict. Assert the shape the real consumers read (finalMessage content blocks).
- [ ] **Step 5: Verify** tsc + vitest green. **Commit** — `feat(demo): mock Anthropic planning client (scripted artifacts + tool calls)`

## Task 4: Demo entry, seed, and wiring

**Files:** `src/lib/demo/demoMode.ts`, `src/lib/demo/demoContent.ts`, `src/main.tsx`, `src/cadre/SignIn.tsx` (entry button), and a small seed helper.

- [ ] **Step 1: `enterDemoMode()`** — (a) `installMockBackend(new MockFs(seedFiles))` where `seedFiles` includes a demo `cadre.json`, `docs/prd.md`/`architecture.md` (with a frozen verify command), a `docs/stories/*.md` backlog (several stories, mixed statuses via seeded `.cadre/state/*.json`), CLAUDE.md, etc. from `demoContent`; (b) mark demo mode on; (c) navigate the app into the seeded project + phase. The seed should land the user in **Execute** with a populated board AND leave Plan explorable.
- [ ] **Step 2: entry point** — support `?demo=1` (checked in `main.tsx` before render → call `enterDemoMode()` then render), AND a "Try the demo (no sign-in)" button on `SignIn.tsx` that calls `enterDemoMode()` + proceeds. In a real Tauri build, hide/disable the demo entry (guard on `!realTauri`).
- [ ] **Step 3: make it flow** — after entering, verify by manual/headless smoke: land in the app → Plan shows the seeded PRD; navigate Execute → Kanban shows the seeded backlog; click Auto-execute → mock agents stream in the Fleet org chart and cards move Backlog→In Progress→QA→Completed; a PM chat message produces a doc via the mock Anthropic. Fix whatever doesn't flow.
- [ ] **Step 4: Verify** `npx tsc --noEmit && npx vitest run && npm run build` green.
- [ ] **Step 5: Commit** — `feat(demo): demo-mode entry + seeded project (all screens interactive on the web)`

---

## Self-Review

**Spec coverage:** mock Tauri backend → Task 1; mock agent → Task 2; mock planning → Task 3; entry + seed + wiring → Task 4. All screens reachable (Plan via mock Anthropic; Execute/Fleet/Kanban/Done via mock backend + agent). ✓

**Gating/invariance:** the mock installs ONLY in a browser demo entry, guarded on the real `__TAURI_INTERNALS__` being absent; `makeAnthropic` returns the mock ONLY when `isDemoMode()`. The real Tauri path and the 420 tests are untouched.

**Type consistency:** `MockFs` (Task 1) used by `installMockBackend` + the seed (Task 4); `makeMockAnthropic` (Task 3) routed in `planningChat`; `demoContent` shared across Tasks 2–4.

**Risk notes for reviewers:** (1) the `create_pty` Channel `data` MUST be `number[]` UTF-8 bytes (per `decodePtyData`). (2) the mock Anthropic must match the SDK stream/`finalMessage` shape the real consumers read — the highest-risk fidelity point. (3) unmapped `invoke` commands must resolve (warn) not hang.
