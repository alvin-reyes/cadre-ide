# Cadre — an Agentic OS for Software Engineers

> **Thesis.** A software engineer should *command a fleet of disciplined agents*, not babysit one chat. Cadre is the operating system that makes that possible: agents are first-class **processes**, and the OS provides **scheduling, isolation, policy, memory, observability, and a shell** so the work is *verified, not vibed*. Same kernel, two faces — a desktop cockpit and a `cadre` CLI.

This document is the map: what the OS *is*, which primitives already exist in the codebase, where the gaps are, and the roadmap to close them.

---

## Design principles

1. **Verified, not vibed.** The engine decides `Done` — an agent never self-reports completion. A story only advances by passing its frozen verification command and an adversarial review gate. (`src/lib/engine/{orchestrator,reviewFleet,transitions}.ts`)
2. **Isolation by default.** Every agent runs in its own `task/<id>` (or `story/<e>.<s>`) **git worktree** on a dedicated branch. Parallel agents can't corrupt each other or `main`. Merges are serialized. (`src/lib/engine/{dispatch,integrate}.ts`)
3. **Policy at the kernel.** Gates (plan approval, code review) and standing reviewers (Guardian, Audit) are *enforced by the system*, not advisory. Agents get read-only tool allowlists unless a task needs more.
4. **Agents are processes.** A running agent is a PTY-backed process with a lifecycle (spawn → run → exit), a working directory, streamed output, and a status. The fleet is a process table.
5. **One kernel, two faces.** The engine runs on **injected dependencies** (`DispatchDeps`, `ReviewFleetDeps`, `IntegrateDeps`, `RunStoryDeps`). The desktop wires them to Tauri; the CLI wires the *same interfaces* to Node. No logic is duplicated. (`src/lib/engine/tauriDeps.ts`, `src/cli/nodeDeps.ts`)

---

## The primitives (OS layers)

| Layer | What it is | Exists today | Gaps |
|---|---|---|---|
| **Kernel / scheduler** | dispatches & sequences agents under resource + safety policy | engine: disjoint-file batching, `maxDevAgents` cap, plan→verify→review→integrate pipeline (`useCadre.dispatchReady`, `orchestrator.ts`) | policy not surfaced/configurable; no cross-project scheduler |
| **Processes** | an agent = a process in a worktree | PTY agents (`pty.rs`), interactive Maintain fleet, `spawnAgent`/`waitForExit` | no durable process table across restarts; no `ps/kill/restart` |
| **Shell & syscalls** | how humans + code drive the kernel | `cadre` CLI (`run`, `status`), and the `invoke()` dep-interfaces as "syscalls" | shell is thin — no `plan/shard/ps/kill/logs/watch` |
| **Filesystem / workspace** | where work lives | git worktrees, `.cadre/` state, project tabs, workspace snapshots, terminal-session persistence | no workspace/agent GC; no multi-repo scheduler view |
| **Memory / context** | what agents know | `CLAUDE.md` constitution, injected Context Store, per-story sessions (`--resume`), claude-mem | no shared, queryable long-term memory surface |
| **Security / policy** | the guard | plan + review gates, **Guardian + Audit** background reviewers (`evaluationStore`), read-only allowlists | no per-agent capability model; guardian is on-demand, not a standing service |
| **Observability** | seeing the system | board/kanban, fleet org-chart, AI Log, findings notification bar, toasts | no unified event stream / `cadre logs`; no metrics |
| **Boot / init** | first run + drivers | (settings + keychain exist) | ⛔ **no onboarding** to connect services (claude login, planning key, GitHub) |
| **User space / apps** | what you run on it | **Build** mode (plan→execute→done), **Maintain** cockpit (prompts, thoughts, fleet tiles), prompts/templates libraries | agent personas/prompts not packaged as installable units |

---

## Two faces, one kernel

```
        ┌──────────────── User space ────────────────┐
        │  Desktop cockpit (Tauri)   │   cadre CLI    │
        │  Build · Maintain · Fleet  │  run · status  │
        └───────────────┬────────────┴───────┬────────┘
                        │  same engine interfaces
        ┌───────────────▼──────────────────────────────┐
        │  KERNEL: dispatch · verify · review · integrate│
        │  scheduler (disjoint-file batches, agent caps) │
        │  policy (plan/review gates · guardian/audit)   │
        └───────────────┬──────────────────────────────┘
        ┌───────────────▼────────┐   ┌──────────────────┐
        │ Processes: PTY agents   │   │ FS: git worktrees │
        │ in isolated worktrees   │   │ + .cadre state    │
        └────────────────────────┘   └──────────────────┘
```

The desktop is the cockpit; the CLI is the shell. Both are clients of one kernel — which is why a headless `cadre run` and the GUI produce identical, verified results.

---

## Roadmap

**Phase 0 — foundations (shipped, this branch).** Maintain cockpit (interactive subagent terminals, prompts library, multi-page Thoughts dock, draggable/resizable fleet tiles); Guardian + Audit background agents with a findings bar; the `cadre` CLI Slice 1 (`run`/`status` on the real engine via Node deps); light theme + startup fix; process-driven subagent status.

**Phase 1 — complete the shell.** `cadre plan "<brief>"` (PM/Architect → PRD + architecture + verify command) · `cadre shard` (SM → stories) · so `cadre` alone runs **new → plan → execute → done**. *Unblocks building real projects headlessly (e.g. the marketing site) end-to-end from the terminal.*

**Phase 2 — process manager.** A lightweight daemon so agents are durable managed jobs: `cadre ps` (running agents + status + worktree), `cadre kill <id>`, `cadre logs <id> [-f]`, survivable across GUI restarts. The OS process table, unified between GUI and CLI.

**Phase 3 — boot / onboarding.** A first-run screen (and `cadre login`) to **connect services**: claude.ai login for the fleet, an Anthropic/DeepSeek/Kimi key for planning, GitHub for PR handoff. Removes the recurring "connect services" friction; drivers for the OS.

**Phase 4 — policy & scheduling.** Surface + configure the scheduler: concurrency and resource policy, per-agent capability/tool policy, and **Guardian as a standing kernel service** (runs on every integrate, not just on demand).

**Phase 5 — packages / registry.** Agent personas and prompt/template libraries as *installable units* — a shareable registry of "apps" for the OS.

---

## Non-goals / guardrails

- **Not** a general chatbot. Every unit of work flows through the verify/review discipline.
- **No self-reported Done.** The kernel owns state transitions; agents never write their own completion.
- **Least privilege.** Reviewers are read-only; write access is scoped to a task's own worktree.
- **Human-in-the-loop where it matters.** Plan sign-off and PR handoff are deliberate, gated actions.

---

*Next: pick a phase to execute. Phase 1 (complete the shell) is the highest-leverage — it turns `cadre` into a full lifecycle and lets us build real projects headlessly.*
