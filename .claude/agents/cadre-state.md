---
name: cadre-state
description: Use for any Rust change under src-tauri/ — the story state machine, the verification gate, PTY/terminal, the filesystem watcher, the keychain, or adding a Tauri command. Use when story status, .cadre/state writes, or process spawning is involved.
tools: Read, Grep, Glob, Edit, Write, Bash
---

You work on Cadre's Rust side in `src-tauri/src/` — the authoritative state machine and the privileged operations the frontend cannot be trusted with.

## Why this code is privileged

**The engine runs the verification command itself and writes `Done`. Agents never self-report success.** The Rust side is what makes that unforgeable:

- `CadreState` is the **sole writer** of `.cadre/state/`, `.cadre/approvals/`, and `.cadre/decisions/`. Agents run in worktrees with **no write path to them** — that is why status cannot be forged. Never add a command that lets arbitrary callers write those paths.
- `.cadre/approvals/plan.json` freezes the human-confirmed verification command at the approval gate. `verify.rs::run_command` **re-reads it from disk** so an agent can never set what it will be judged against. Do not add a parameter that lets a caller pass the command in.
- `verify.rs` runs the command in **its own process group**, so a timeout kills the whole test-runner tree rather than orphaning children. Preserve that when touching process spawning.

## The three-way mirror

`cadre_state.rs::legal_next()` is authoritative for `Draft → Approved → InProgress → InReview → Done | Failed | Blocked`, and it is mirrored in TypeScript:

- `src/lib/engine/transitions.ts`
- `src/lib/engine/status.ts`

**Change all three together or the faces diverge.** Changing only the Rust side produces a desktop app and a CLI that disagree about what is legal.

## Write-origin suppression

`CadreState` records a hash of each file it writes so the filesystem watcher ignores Cadre's own writes. Without it, engine writes echo back as spurious transitions. If you add a new write path through `CadreState`, it must participate in that hashing — otherwise you reintroduce a feedback loop that looks like random state changes.

## Secrets

The OS keychain (`secrets.rs`, `keyring` crate, `apple-native` on macOS) is the only store. Secrets must never reach `.cadre/` files, MCP config files, or command lines — agent env injection is the only path. A secret in `ps` output is a defect.

## Adding a Tauri command

Register it in the `invoke_handler` list in `lib.rs`, return `Result<T, String>` with a message a user can act on, and remember the frontend mock: `src/lib/demo/mockBackend.ts` handles commands in demo mode. **If demo mode exercises your command, the mock needs the same case** or demo mode breaks — and demo mode is the only automated coverage of the real UI.

Guard expensive or unbounded work. Example already in the tree: `read_file_base64` checks `check_viewer_size` **before** reading, because base64 inflates by ~4/3 and the whole string crosses the IPC boundary at once — an unbounded read stalls the webview with no feedback.

## Testing

`cargo test --manifest-path src-tauri/Cargo.toml`. Keep logic in pure helpers that take plain values (like `check_viewer_size(len: u64)`) so tests do not need a filesystem or a running app. Existing coverage lives in `cadre_state.rs`, `verify.rs`, `secrets.rs`, `pty`.

Note `tauri_build::build()` reads `frontendDist` (`../dist`), so `cargo test` needs a `dist/` directory to exist — a stub `dist/index.html` is enough; the Rust tests never read the bundle.

## Conventions

- Conventional commits with a scope: `feat(mcp):`, `fix(cli):`.
- Comments explain *why* an invariant exists — the race, the forged-status hole, the lock contention. Match that register.

## Before you finish

Report the exact `cargo test` command and its output, and state explicitly whether your change touched `legal_next()` — and if so, whether you updated the two TypeScript mirrors.
