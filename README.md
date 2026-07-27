<h1 align="center">Cadre</h1>

<p align="center"><b>Disciplined AI development. Verified, not vibed.</b></p>

<p align="center">
A keyboard-first, terminal-centric desktop IDE that lets an architect / product owner run a
<b>disciplined</b> fleet of AI agents — where both the <i>method</i> (BMAD) and the <i>engineering</i>
(TDD, review, machine-verified QA gates) are <b>enforced, not hoped for</b>.
</p>

<p align="center">
Built with <a href="https://v2.tauri.app/">Tauri v2</a> (Rust) + React 19 + TypeScript +
<a href="https://xtermjs.org/">xterm.js</a>. Drives <a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code</a> agents in live PTYs.
</p>

---

## What it is

Cadre turns the [BMAD Method](https://github.com/bmad-code-org/BMAD-METHOD) into a real IDE. You don't
skip from an idea to a pile of generated code — you pass through **requirements → architecture →
context-engineered stories → parallel implementation → machine-verified QA**. The single
load-bearing rule:

> **Cadre runs the tests itself and writes `Done`. Agents never self-report success.**

The status of every story is owned by a Rust state machine, not by the agents. An agent can claim it
finished, but the engine re-runs the human-frozen verification command and decides — green ⇒ `Done`,
otherwise `Failed` / `Blocked`. That wedge is what makes it safe to point a cheaper/faster model at
the work.

## The loop

1. **Plan** — converse with planning personas (PM, Analyst, Architect, Design, Technical Writer) in
   the Planning Studio; artifacts (`prd.md`, `architecture.md`) form live as you talk. Sketch flows
   as Mermaid diagrams the AI can read.
2. **Approve** — sign off the plan and **freeze a verification command**. No approval, no fleet.
3. **Shard** — the Scrum Master breaks the plan into a full-lifecycle backlog of stories
   (`epic.story`), each context-engineered for an agent.
4. **Dispatch** — a **role-composed fleet** runs **in parallel**, each agent in its own isolated git
   worktree on a per-story branch. Stories are routed by role: a dedicated **QA** agent and a
   **DevOps** agent (one story at a time each), plus **Dev** agents that scale to demand up to a cap.
   File-disjoint scheduling keeps concurrent agents from colliding; if a role agent is busy, its work
   falls back to an idle Dev so nothing stalls. A shared **Context Store** keeps their contracts
   consistent.
5. **Verify** — the engine runs the frozen command against each worktree and writes the authoritative
   status. An **adversarial code-review fleet** (diverse lenses) can gate the merge.
6. **Integrate** — verified work merges back to main (serialized); a conflict marks the story
   `Blocked` for you, never a silent clobber.

## Features

- **Three views** — an **Orchestrator** board (plan → shard → fleet → done), a **File** view (Monaco
  editor + tree + integrated terminal + project-wide search & replace), and a **Terminal** view
  (tabbed, with split panes).
- **Role-composed, auto-scaling fleet** — a dedicated QA agent + a DevOps agent are always on, and Dev
  agents scale up and down with the ready work (capped by a **Max Dev agents** setting). Each story is
  routed to the matching-role agent; busy roles fall back to an idle Dev so the board never blocks.
- **Parallel, live multi-project** — open several projects as tabs; a background project's agents keep
  advancing its board while you work in another; open tabs restore on relaunch.
- **Engine-owned status machine** — `Draft → Approved → InProgress → InReview → Done / Failed /
  Blocked`, enforced in Rust; illegal transitions are impossible, not merely discouraged.
- **Isolated worktrees + merge-back** — every story builds in its own git worktree; verified work
  merges to main, conflicts quarantine as `Blocked`.
- **Session journal** — an append-only `.cadre/session.md` of what's been planned, built, and shipped,
  shared with the Orchestrator and every dispatched agent so they know the project's state.
- **Session resume** — re-dispatching a failed story resumes its prior `claude` session, keeping what
  it already tried.
- **Floating Orchestrator copilot** — a project-management chat with live fleet context; dock it as a
  side panel or maximize it.
- **Multi-provider fleet** — dispatch on Claude, or on Kimi (Moonshot) / DeepSeek via their
  Anthropic-compatible endpoints; run Claude agents off your `claude` CLI login instead of a key.
- **Errors, never silent** — every failure surfaces as a toast and a persistent entry in the AI Log.
- **Brownfield onboarding** — point Cadre at an existing project; it documents the codebase to ground
  the plan.

## Build from source

Prerequisites: **Node.js 20+**, **Rust (stable)**, and [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
(`npm install -g @anthropic-ai/claude-code`) for the agent features.

```bash
npm install
npm run tauri dev      # development
npm run tauri build    # production
```

Frontend tests (Vitest) and the Rust engine tests:

```bash
npx vitest run               # engine logic — pure + dependency-injected
cd src-tauri && cargo test   # Rust state machine + commands
```

## Status & roadmap

Actively built. The disciplined loop — plan, approve, shard, role-composed parallel dispatch, verify,
review, merge-back — works end to end, across multiple live projects.

Recently landed: the **role-composed auto-scaling fleet** (QA + DevOps + demand-scaled Dev) as the
default execution model, **polyrepo support** (one Cadre project orchestrating several code repos,
each story targeting a repo), and a **provider sign-in** (one credential — Claude login / Anthropic /
DeepSeek / Kimi — driving both planning and dispatch). See
[`docs/superpowers/plans/`](docs/superpowers/plans/) for the design specs and implementation plans.

Cadre is the evolution of [ADE](https://github.com/alvin-reyes/better-agentic-ide) (a keyboard-first
agentic terminal), refocused around the disciplined loop.

## License

ISC
