# Cadre — Design Specification

**Date:** 2026-07-21 (rev. 3.3 — named; build-readiness + consistency)
**Status:** Draft (awaiting author sign-off)
**Author:** Alvin Reyes (with Claude)
**Name:** **Cadre** — CLI `cadre`, GitHub org `cadre-ide`, brand at `cadre.dev` (see §11). Engine dir: `.cadre/`.

> **Rev 3 changes:** after a second review confirmed rev 2's bones but found two blockers, this rev
> (1) **stages v0 into a v0.0 walking skeleton → v0.3** (smallest thesis-prover first); (2) **defines the
> verification-command trust model** (the thesis was still hand-waved); (3) replaces the approval
> "signed token" with **process separation** (engine is the sole writer of authoritative state);
> (4) honestly scopes the **engine API as an in-process seam, not a network server, in v0**; and
> (5) fixes several milestone/consistency mismatches. Findings log in §12.

---

## 1. Overview

**cadre** is a keyboard-first desktop application that gives a technical architect / product owner /
hands-on engineer a *disciplined* way to build software with a fleet of AI agents. It is the **BMAD
evolution of [ADE](https://github.com/alvin-reyes/better-agentic-ide)** — a build-on of the existing
Tauri app, not a VS Code extension or fork.

> **Cadre — disciplined AI development. Verified, not vibed.** The one agentic IDE where the machine
> *proves the work before it's done*: the engine runs the tests (and, per vertical, the audits) itself —
> agents never self-report success.

**The wedge is verification.** Everything else ladders up to it: **BMAD** gives a real plan with real
acceptance criteria *to verify against*; the **fleet** makes verified work *scale*; the **cockpit** lets
you *supervise the proof, not the typing*. You cannot skip from a fuzzy idea to a pile of generated code —
you pass requirements → architecture → context-engineered stories → implementation → **machine-verified**
QA. The single load-bearing claim: **Cadre runs the tests itself and writes `Done`; agents never
self-report success** (§6.1).

**Anti-positioning:** not a vibe-coding tool, not autocomplete, not an "AI pair programmer." The
disciplined opposite — *slower to start (you plan), faster to trust (it's proven).*

**The engine is general** (domain-agnostic). Verticals — web3, AI/ML, fintech — are served by **additive
role packs**, not a specialized core (§3.9). web3 is the lead **beachhead hypothesis** (the verification
wedge is sharpest where unverified code means *lost funds*), gated on distribution — not committed.

**Delivery philosophy:** cadre applies its own discipline to itself. We ship a **v0.0 walking skeleton**
that proves the thesis end-to-end on one story, then grow it in tight stages (§9).

---

## 2. Target user & guiding principles

### The user
A **technical architect / product owner who is also a hands-on engineer** — CLI-first, operating *above*
the code but dropping *into* it when needed. Full-stack across the lifecycle. v0/v1 are **single-player
and local**. **Mobile full-control access and project sharing** (own devices + teammates) are a defined
**later pillar** on an engine seam reserved in v0 — see §3.7.

### Second audience: the academy (learners)
cadre is intended to be productized as part of the author's academy. Enforcement, however, **is not
instruction** — a real teaching layer (rationale, worked examples, guided projects, progression) is its
own milestone, sketched in §10 and scheduled *after* the v0 core. v0 is honestly architect-first.

### Honest framing: a GUI cockpit around live terminals
The center of gravity is **live agent terminals you watch work** (PTYs running `claude`). cadre is,
plainly, a **GUI application with terminals embedded in it** — a cockpit *around* live terminals — not a
terminal app with GUI garnish. "CLI-first" means the terminal session is the unit of work and
observation.

### The two discipline pillars (both enforced)
1. **Process discipline (BMAD):** requirements → architecture → sharded stories → QA gates, in order,
   hard-gated.
2. **Engineering discipline (per story):** test-driven; a **Reviewer** pass (an cadre-added step, *not*
   a BMAD persona; BMAD's QA/Quinn owns the formal gate); **verification before "done" enforced by the
   system running the tests** (§6.1), never by an agent's self-report; clean git hygiene
   (branch-per-story, §6.2); traceability (code → story → PRD/architecture).

---

## 3. Architecture

### 3.1 Foundation: evolve ADE (with eyes open)

| Layer | Status |
|---|---|
| Tauri v2 shell · PTY spawn/write/stream (`pty.rs`) · watcher (`watcher.rs`, emits changed content) | **exists** |
| Anthropic-SDK planner + tool-use (`lib/anthropic.ts`) · two-column orchestrator UI · `claude`-in-PTY dispatch · agent tracker | **exists** |
| React 19 / TS / xterm.js / Zustand / Tailwind · `FileBrowser` · Monaco `EditorTab` · `PreviewPanel` (+Mermaid) | **exists** |
| `BmadAdapter` · disk-`Status` state machine + reconciliation · **system-run verification** · engine-owned approval/Status files | **net-new (the spine)** |
| DB drivers · SSH · keychain `SecretsStore` · `ModelRouter` env plumbing · worktree/integration manager | **net-new Rust** (only `portable-pty` + `notify` exist today) |

*Known effort traps (from review): `BmadAdapter`, disk-`Status` reconciliation, and system-run
verification are each multi-week and **sequential** — they are the critical path (§9). ADE's idle→
`completed` coupling (`useTerminal.ts`, `ACTIVITY_TIMEOUT=3000`) is the anti-pattern §6.1 deletes.
`dispatch` currently types `claude -p` into a login shell; §6.1 requires it as the PTY's **direct
child** so process-exit is a clean signal.*

### 3.2 Two hats, one substrate
- **Command Deck** (architect hat) — the disciplined BMAD loop: plan → fleet → supervise.
- **Workbench** (engineer hat) — inspect and touch: code, files, DBs (v0.3+), hosts, logs.
Both are GUI surfaces wrapped around live terminals.

### 3.3 Execution model (hybrid)
- **Planning brain = Anthropic SDK** (structured PRD/architecture/story output). **Claude-only** through
  v1.
- **Fleet execution = Claude Code CLI in PTY panes.** Dev / Reviewer / QA run as `claude -p` sessions
  (spawned as the PTY's **direct child**) you watch.

**BMAD content *is* the prompt engine (not cadre's own prompts).** cadre does not invent persona prompts;
the `BmadAdapter` (§7) composes BMAD's real content into every model call:
- a **persona file's YAML** (`role / style / identity / core_principles`) → the **system prompt** for
  that agent (SDK planner for PM/Architect/PO/…; the `claude -p` invocation for Dev/QA);
- a **template** (`prd-tmpl` / `architecture-tmpl` / `story-tmpl`, with `owner`/`editors`) → the
  **output structure** the agent must produce;
- a **task** (`create-next-story`, `shard-doc`, `review-story`) → the **workflow procedure** the agent
  follows;
- **`devLoadAlwaysFiles`** (coding-standards / tech-stack / source-tree) → always-injected context.
This **replaces ADE's current generic prompts** (its "project planner" prompt + the ~26 `agentProfiles`)
— see §8. cadre uses BMAD's **content**, not its **activation mechanism** (no `/dev` slash-commands or
IDE trigger files), which is why it's decoupled from v4-vs-v6 activation but coupled to the content
contract (§3.4).

**Multi-model routing (later — see §9).** Mechanism verified: Claude Code selects **endpoint and model
independently** — `ANTHROPIC_BASE_URL` (destination) + `ANTHROPIC_AUTH_TOKEN` (key, *not*
`ANTHROPIC_API_KEY`) + `--model`/`ANTHROPIC_MODEL`; behind a custom base URL the model string passes
through unchecked. These are **per-process**, so parallel PTYs can each run a different provider. Kimi
and DeepSeek expose Anthropic-compatible endpoints; LiteLLM fronts the rest. **Two gates keep it out of
early milestones:** (1) **`create_pty` accepts no `env` map today** — a small Rust change adds the seam
(done in v0.0 for cleanliness); (2) **tool-use fidelity** on non-Claude models behind the shim is
unproven and needs a **spike**.

**Provider *choice* is available now (pulled forward).** `src/lib/engine/providers.ts` lets the user run
**Claude, Kimi (Moonshot), or DeepSeek** — `resolveAgentEnv` composes the endpoint + auth per provider
(native `ANTHROPIC_API_KEY` for Claude; `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` for the
Anthropic-compatible ones), feeding `dispatchStory`'s env/model. **The wedge makes this safe:** whatever
model writes the code, the engine verifies the output — so choosing a cheaper/faster model is low-risk,
and a bad route surfaces as `Failed`, not a silent regression. *Still honest:* validate each provider's
tool-use fidelity per §14; **domain-based auto-routing** (a `domain:` tag choosing the model *per story*)
remains *later* — this is user-selected provider choice, not automatic routing.

### 3.4 BMAD integration target: v4 contract, v6 seam
Target the stable **v4 `.bmad-core/` contract**; **detect-and-refuse** v6 (`_bmad/` + `config.toml`).
cadre runs its own engine, so it's decoupled from BMAD's activation-file scheme; it consumes BMAD's
**content** and honors its **artifact contract** only, all via `BmadAdapter`. Pin/validate a known-good
v4 point release and **bundle it** for onboarding (§7).

### 3.5 The Context Store (module deferred to v1)
A multi-model fleet shares no hidden state, so coherence needs an explicit, model-agnostic context
substrate. **v0** does *not* build a module: agents get BMAD's `devLoadAlwaysFiles` injected inline
(already exists in BMAD). **v1** adds `ContextStore` owning cadre's **ADRs + agent memory**, composing
per-dispatch slices *by pointer* over BMAD's canonical artifacts — no duplication. ADRs live under
**`.cadre/decisions/`** and are **committed** (part of the durable project record, §3.8); agent memory is
opt-in to commit. *(Context-Store failure is therefore a v1 error state, not v0.)*

### 3.6 Secrets & credentials
Secrets live in the **OS keychain** via a thin `src-tauri` wrapper over the Rust **`keyring` crate** —
*not* the deprecated Stronghold plugin, and preferring a direct wrapper over lightly-maintained community
plugins. Never plaintext, never committed. `SecretsStore` = Rust commands + thin TS wrapper. **v0.0 needs
the Anthropic key only** (migrating it off today's plaintext `localStorage`); DB passwords arrive with
the DB viewer (v0.3); SSH/other providers later.

**Model keys — asked once, per provider.** A model key (Anthropic in v0.0; Kimi/DeepSeek/etc. when
multi-model lands) is entered **one time** during setup, stored in the keychain, and **reused silently**
thereafter. cadre re-prompts **only** on a missing/invalid/expired key ("this key stopped working"),
never routinely. "Add a model" = paste a key once. Keys are **per-device** today; when the relay pillar
(§3.7) lands they can sync across *your* devices — but secrets stay **host-side** and are never pushed to
a phone client.

### 3.7 Engine + clients + relay (mobile & project sharing) — later pillar, v0 seam only
**Requirement:** operate cadre from a **mobile app** with **full control**, and **share projects** across
the author's own devices and with **teammates/collaborators**. The fleet cannot run on a phone, so cadre
factors into engine + clients + relay:

- **cadre engine** — the headless-capable core (state machine, worktrees, fleet, verification,
  budget/watchdog) on a **host**.
- **Clients (full control):** Desktop (Tauri, full Cockpit + Workbench) and **Mobile** (Tauri v2
  iOS/Android; touch-first command deck + escalation inbox + push). Heavy surfaces (code/DB/terminals)
  stay desktop-ergonomic.
- **Relay / sync service:** hosted broker for cross-network reach + project sync + accounts/auth +
  share invites + per-collaborator roles. Effectively cadre's cloud/SaaS.

**Multi-actor coordination:** multiple full-control clients on one project need a **driver-lock /
serialized command queue + presence** model. Reintroduces multi-user; owed at that milestone.
**Security surface:** accounts, TLS, device pairing, per-command authorization, audit; secrets stay
host-side.

**What v0 actually reserves (corrected):** *not* a running network API. v0 defines the engine as a
**UI-agnostic module with a typed, serializable command/event interface (in-process)** — the desktop UI
calls it directly through that boundary. A network transport wraps this interface *later*. So "all
clients are peers over the API" is a **later** property; the v0 obligation is only: **the engine holds no
UI state and emits serializable events**, so a transport can be added without a rewrite.

### 3.8 Project persistence & reload (committed to the user's repo) [v0.0]
A cadre project is **fully reconstructable from git**. When the user pushes their project to GitHub, the
committed files carry everything needed to **reload exactly where they left off** — and a teammate who
clones gets the same. **Git is the source of truth; no cadre server or external state is required.**

- **Committed (travels with the project):**
  - **`.bmad-core/`** — the **BMAD strategy** (personas, templates, tasks, `core-config.yaml`). Committed
    so everyone shares the same method.
  - **`docs/`** — the plan artifacts (`prd.md`, `architecture.md`, sharded docs, `docs/stories/*.md`).
  - **`.cadre/state/`** — authoritative story `Status` (so the board reconstructs).
  - **`.cadre/approvals/`** — approval markers **+ the confirmed verification command** (the decision
    record + the gate rule).
  - **`.cadre/decisions/`** — ADRs (and, v1, committed agent memory if enabled).
- **Gitignored (ephemeral / machine-local):** `.cadre/markers/` (transient agent result drops),
  `.cadre/worktrees/` (worktree scratch), live PTY/session state, `node_modules`, `src-tauri/target`,
  `dist`.
- **Reload behavior:** on opening a cloned or reopened project, cadre **reconstructs the Cockpit** —
  phase, Fleet board, story statuses, plan viewer, and the gate rule — from the committed `.bmad-core/`
  + `docs/` + `.cadre/state|approvals|decisions`.
- cadre **scaffolds the project's `.gitignore`** (onboarding, §7) to encode this committed-vs-ephemeral
  split.

*(This refines §3.5's "gitignored by default": the **durable project record is committed** — only
ephemeral scratch is ignored.)*

### 3.9 Vertical role packs (general engine + domain roles)
The engine is **domain-agnostic**; a vertical is an **additive BMAD expansion pack**, never a forked
core. A pack layers on three things:

- **Roles/personas.** A web3 pack adds `auditor` and `pentester` (beyond the core analyst / pm /
  architect / po / sm / dev / qa); an AI/ML pack adds eval/benchmark roles. These load through
  `BmadAdapter` exactly like core personas — **they are just more persona files**, and
  `composeSystemPrompt` already handles any role, so no engine change is needed.
- **Extra gates in the story pipeline.** The sequence a story passes through is a **data-driven list of
  gate-roles**, not hard-coded. Core = `dev → reviewer → qa`. web3 = `dev → reviewer → qa → auditor →
  pentester`. Adding a vertical gate is configuration, not a rewrite.
- **A verification profile.** The vertical's real tools wired into `run_verification` — web3 = Foundry
  tests **+ Slither** (static analysis) **+ Echidna** (fuzzing); AI/ML = the eval suite. This is what
  makes the "proof" tangible per domain, and it's precisely why web3 is the sharpest beachhead:
  *unverified generated code = lost funds*, and Cadre proves it before `Done`.

**Milestone:** v0.0 ships **core roles only**. Role packs are a post-v0.0 capability; the architecture
already reserves the seam (arbitrary-persona loading is done; the pipeline just becomes a role sequence).

---

## 4. The two hats — components

*(Milestone tags per §9: **[v0.0]** walking skeleton · **[v0.1/0.2/0.3]** v0 stages · **[v1]** · **[later]**)*

### 4.1 Command Deck
- **[v0.0] Planning Studio (PM + Architect)** — conversational planning producing `docs/prd.md` +
  `docs/architecture.md`, with the **PLAN gate** always visible. Full **Analyst→PM→Architect→UX→PO** walk
  is **[v0.1]** (quality, not thesis).
- **[v0.1] Plan viewer** — a rendered, navigable reading surface for the plan: formatted Markdown,
  **Mermaid architecture diagrams rendered as visuals** (not code fences), an **outline/TOC**, a
  **sharded-doc tree** (PRD→epics; architecture→tech-stack/coding-standards/source-tree/data-models/API-
  spec…), and **traceability links** — requirement/epic ↔ the stories it spawned ↔ the architecture
  sections a story must honor (makes "code → story → PRD/architecture" navigable). **v0.0 builds no new
  viewer** — it reuses the existing `PreviewPanel` **as-is** to render `prd.md`/`architecture.md` with
  Mermaid; the Plan viewer as a distinct component (outline + sharded-tree + traceability) is v0.1.
- **[v0.1] Plan annotations (review comments that feed the brainstorm)** — highlight any text/section in
  the Plan viewer and attach a **comment**; it re-enters planning as **scoped feedback** (the relevant
  persona revises *that section* live, or replies/asks in the conversation), with status
  **open → addressed → resolved**. Comments are a persisted **decision record** under `.cadre/` (why the
  plan changed — traceability + academy material). **Anchoring:** a comment binds to the **BMAD template
  section id + a quoted snippet**, not raw character offsets; when the persona rewrites the doc, cadre
  re-anchors **open/addressed** comments by fuzzy-matching the quote, and marks one **"orphaned — needs
  re-anchoring"** if the match fails **or is ambiguous** (multiple candidates) rather than silently
  mis-pointing. **Resolved comments are *frozen*** — snapshotted to the doc version they were resolved
  against; they do **not** re-anchor or re-open, they stay in the decision-record timeline attached to
  that revision (so the "why" survives later rewrites). Single-player in v0.1; **multi-user commenting
  rides in with the later sharing pillar** (§3.7).
- **[v0.0] Fleet board** — story cards reflecting on-disk `Status`, reconciled live by `watcher.rs`.
- **[v0.0] Watchable agent** — the running Dev agent is a live PTY you can open. **Reviewer [v0.1]**,
  **QA/Quinn gate [v0.2]**.
- **[v1] Auto-delegation pipeline + adaptive grid** · **[v1] individual sub-agent observability grid.**

### 4.2 Workbench
- **[v0.0]** Terminals, **File browser**, **Code viewer** (Monaco), **Preview panel** (+Mermaid). *(All
  exist.)* A **plain shell is always one keystroke away** — **`⌘T` opens a bare terminal** (a scratch
  CLI for ad-hoc commands), distinct from the agent/story terminals. Reuses ADE's existing new-tab/PTY
  path; free in v0.0.
- **[v0.3 · independent track] Database viewer** — pick a connection, list tables/**collections**, run
  queries, results grid. `sqlx` (Postgres/MySQL/SQLite, runtime query API) + official **`mongodb` crate**
  (schemaless BSON → its **own** grid path) + minimal DB Connections manager (passwords via §3.6). Shares
  no fleet-spine code; deferred out of v0.0 because it proves nothing about the thesis and can be added
  later at ~zero integration cost.
- **[later] SSH / host connections** · **[later] Log viewer.**

### 4.3 UX & interaction design (from the UX pass)
- **Shell = Cockpit** — one screen: phase stepper, Fleet board (left), live agent area (center),
  Workbench dock (right).
- **Fleet view = auto-delegation pipeline + adaptive grid** *(pipeline/grid are [v1]; v0 shows the board
  + a single agent)*.
- **Planning Studio = conversation + live document.**
- **Workbench = full-swap (`⌘⇥`) primary + slide-over drawer for peeks.**
- **Approval & escalation surface** — the human-decision inbox (§6.3); first-class.
- **Visual identity = Calm Studio base + Warm Craft / Mission Control themes** *([later])*.
- **Premium bar = "Linear-grade minimal."** Crafted, calm, and *fast* — not flashy. Restraint (little
  chrome, generous whitespace, one confident indigo accent), a refined type scale on a premium system
  stack (`SF Pro`/`Inter` UI, crafted mono for terminals), subtle depth (hairline borders + soft
  elevation), and physical micro-motion (spring easing, 120–240ms). Speed is a feature: instant, no jank.
  Enforced via a **design-token layer** (`src/styles/tokens.css`) every Cadre surface builds on.
- **No emoji, ever, in the UI.** Icons are **Lucide** line icons (`lucide-react`), consistent stroke and
  size. (Emoji render inconsistently across platforms and read as amateur — banned for the premium bar.)

---

## 5. The enforced state machine

**Authoritative state is engine-owned, not agent-writable.** The story markdown holds agent record
sections; the **authoritative `Status` lives in an engine-only file** (e.g. `.cadre/state/{epic}.{story}.json`)
that agents have **no write path to** (§6.3). This removes the agent-vs-engine write race on one file and
makes `Status` un-forgeable.

**Status is *fully externalized* (resolving the dual-source-of-truth trap).** BMAD's story template also
carries a markdown `## Status` section — cadre **does not co-own it**: `BmadAdapter` treats the markdown
`## Status` as **read-only / ignored** (the engine JSON is the *sole* source), so there is never a second
authority to reconcile. The **engine state-owner is a thin Rust module** (not TS): it is the sole writer
of `.cadre/state/` and `.cadre/approvals/`, which — being outside every agent worktree cwd — genuinely
can't be reached by a `claude -p` agent. (Consequently "section-ownership *enforcement*" is **best-effort
in v0** — real enforcement of a `claude` agent's edits would be a post-hoc diff/revert subsystem, which
is *later*; v0 relies on Status externalization, not on constraining what an agent can write.)

```
Draft ─▶ Approved ─▶ InProgress ─▶ InReview ─▶ Done
  │          ▲            │            │          │
  │          └── human approves ───────┘          │
  └─▶ (Blocked) ◀── error/hang/deps/merge-conflict ┘   Failed ◀── QA fail / verify fail
```

- **PLAN gate:** "Dispatch" is disabled until `prd.md` + `architecture.md` exist **and a human approval
  marker** is present (§6.3). *The PLAN approval also captures the human-owned **verification command*** (§6.1).
- **SHARD (non-skippable):** the SM writes context-engineered `docs/stories/{epic}.{story}.story.md`;
  `Draft → Approved` requires **human approval**, not an agent edit.
- **FLEET:** Dev (TDD) → [Reviewer v0.1] → [QA v0.2], on **branch-per-story** (§6.2). Only the **engine**
  writes `InReview`/`Done`, and only after it **actually runs the verification** (§6.1).
- **QA gate:** `→ Done` only if verification runs green (and QA persona passes, v0.2+). Otherwise
  `Failed` → bounce to `InProgress`, visibly, bounded by an **explicit retry ceiling** (an integer, in
  v0 — not deferred).
- **Re-open (scope change) [v1]:** `Done → Approved`, **human-gated** — the only path back out of `Done`,
  triggered by §5.1 impact analysis. (Added to the machine so a changed dependency can legitimately
  re-open completed work instead of silently drifting.)
- **The board reads the authoritative engine JSON** (not the story markdown). **Write-origin
  suppression:** before writing a state file the engine records the intended `{path, content-hash}`; when
  `watcher.rs` fires for that path, the reconciler matches and **ignores its own write**, so cadre's
  writes never echo back as spurious transitions.
- **Error/Blocked states:** crashed PTY · broken test infra (distinct from test-fail) · unsatisfiable/
  cyclic deps · **merge conflict [v1]** · hung agent (§6.4). *(Context-Store write failure is a v1 state.)*

### 5.1 Scope changes & re-planning
New scope **always re-enters through the front of the loop** — never a hand-injected loose story. **You
add scope by talking to the plan.** Two entry channels, matched to the change size, both routed back
through the gate:

- **Small tweak → plan annotation.** Highlight a section, comment; the persona revises *that section*
  live (§4.1 annotations). *[v0.1]*
- **New feature/epic → the "Add scope" action.** A first-class Planning Studio action opens a planning
  conversation **seeded with the current plan** (personas already know the existing PRD/architecture), so
  the change is treated as a **delta**: the PM adds a **new epic** to the PRD, the Architect updates
  architecture only where affected. *Not* a greenfield session; *not* an ad-hoc story. *[v0.1]*

Whichever channel, the delta lands back on the disciplined rails:
1. **Re-gate** — a material change **re-opens the PLAN gate** for the affected epic(s): re-approve the
   revised plan, and re-confirm the **verification command** (§6.1) if the change affects how "done" is
   judged. *[v0.1]*
2. **Re-shard** — the SM shards only the new/changed scope into **new story files**, which enter the
   board as `Draft → Approved` and flow into the fleet like any other story. *[v0.1]*
3. **Impact analysis** — via **traceability links** (§4.1), cadre surfaces which already-`Done` stories
   depend on a section that changed, and **flags them for review/re-open** rather than letting them
   silently drift. *[v1]*
4. **In-flight bounce** — a story that's mid-build when its own context changes **bounces back** (§5
   `Failed`/`Blocked`); its branch/worktree is **preserved** per the §6.3 blocked-agent policy, and it
   surfaces in the escalation inbox for your decision. *[v1]*

> **v0.1 honesty note:** in **v0.1**, Add-scope **re-gates and re-shards only** (steps 1–2). The safety
> net — impact analysis on already-`Done` stories (step 3) and in-flight bounce (step 4) — arrives in
> **v1**. Until then, **the human is responsible for spotting which `Done` stories a change affects**;
> the prose's "never silently drift" guarantee is a v1 property, not v0.1.

Because every artifact is a versioned file on disk, a scope change is a **diff**, and the annotations are
the **decision record** of *why* — so "what changed, why, and what it affected" is answerable end to end.

---

## 6. The four hard systems

### 6.1 Completion & verification (the thesis; replaces "idle = done")
Idle-detection is a 3-second silence timer that maps quiet→done and can't tell pass from fail — **demoted
to a UI hint only.** Instead:

- **Verification command — human-owned (the trust model).** The command cadre runs to verify a story is
  a **human-owned field captured and frozen at the PLAN gate approval**, stored **engine-side in
  `.cadre/`**, never in an agent-writable artifact. cadre may **auto-detect a suggestion** (`package.json`
  scripts, `cargo test`, `pytest`) but the human **confirms** it; an agent can never set or alter it.
  This closes the "agent controls its own verifier" hole.
- **The test run is the gate; the marker is advisory.** Agents run via `claude -p` (direct PTY child)
  and *should* end by writing an `cadre-result` marker — but cadre **runs the verification command
  itself**, captures the real exit status, and **only the engine** writes the authoritative `Status`.
  Marker present-and-true, present-and-false, or **absent** all yield the same authority: *the test run
  decides.* (Missing marker ⇒ proceed on the verification result; log it.)
- **Mechanism (specified so a builder doesn't guess):**
  - **The verification runner is a new Rust command** — `run_verification(cwd, cmd, timeout) →
    {exit_code, stdout, stderr}` via `std::process::Command::output()` (**not** a PTY — you want a clean
    captured exit code, and this is naturally *separate* from the agent's own PTY). Today **no such
    primitive exists** (`create_pty` drops exit status), so this is a **net-new v0.0 command** (added in
    §8). Its own `timeout` satisfies the "separate from agent wall-clock" rule above.
  - **The `cadre-result` marker is a file-drop, not PTY-stream scraping.** The agent writes it to
    `.cadre/markers/{epic}.{story}.json`, which the existing `watcher.rs` already sees — sidestepping
    ANSI/chunk-reassembly of the terminal buffer entirely. (Scraping the PTY stream is explicitly *not*
    the design.)
  - **The verification command is durable and re-loaded at gate time.** It is captured at PLAN approval
    into an engine-owned file (e.g. `.cadre/state/plan.json`), and **re-read from disk when a story
    reaches the QA gate** (possibly across app restarts) — never held only in memory.
- **Not-applicable / flaky / slow (explicit, not silent):**
  - **No tests** (docs-only/greenfield story) → a first-class **"verification not applicable — human
    attested"** outcome recorded at approval; otherwise a story could never reach `Done`.
  - **Flaky** → `verification: { retriesOnNonZero: N }` before declaring `Failed`.
  - **Slow** → the verification run has its **own timeout, separate from the agent wall-clock budget**
    (§6.4), so a long suite doesn't trip the hang watchdog.

### 6.2 Worktree isolation & integration
- **v0: branch-per-story** in the working tree (or a single worktree per active story) — enough for the
  single-agent loop; the PTY `cwd` targets it (reuses the existing `create_pty` cwd arg).
- **v1: parallel worktrees + a serialized integration queue.** When a story is `Done`, its branch merges
  to the integration branch through a **single-writer queue** (no concurrent `git merge`). Stories branch
  from `integration@HEAD` at dispatch; **rebase-vs-merge policy** defined there. A **merge conflict is an
  explicit `Blocked` state** routed to escalation (never auto-resolved); sibling in-flight stories
  continue and re-target on unblock. *(The whole integration manager is v1 — v0 needs none of it.)*

### 6.3 Approval & escalation model
- **Security is process separation, not crypto.** The threat is an agent on the same machine. A token
  signed on that machine is readable/forgeable by that agent, so signing is theater. Instead: **the
  engine process is the *sole writer* of approval markers and authoritative `Status`, in engine-owned
  paths (`.cadre/approvals/`, `.cadre/state/`) that are kept *outside every agent worktree cwd*** (and,
  where possible, OS file perms). Agents simply have **no write path** to them.
- **Escalation inbox (hero surface):** lists everything **blocked-on-human** — plan approval, story
  approval, QA-fail decisions, budget/hang stops, [v1] scope-change/in-flight bounces, [v1] merge
  conflicts. Each item is a card: **type** · **which epic/story** · a one-line **"why you're here"** ·
  the relevant **context one click deeper** (plan section / diff / QA report) · and one-click
  **approve / reject / redirect**.
  - **"Redirect" is defined:** re-dispatch the same story with human-amended context/instructions
    (optionally after the human edits the story) — *not* an unscoped re-prompt. **Reject** routes back
    (to the SM, or `Failed`). A **plan-gate approval also confirms the verification command** (§6.1).
  - **[v0.0] = a flat list** of blocked items with one-click approve/reject/redirect. That's the minimum
    (matches §13). **[v0.2] = the rich surface:** a persistent **"Needs you (N)"** panel (calm,
    non-interruptive) that **opens into a focused, email-style triage view** with keyboard shortcuts
    (`a` approve, `j` next), plus the interrupt behavior below.
  - **[v0.2] Priority order** (top of the triage list): watch-closely → starvation → plan/gate approvals
    → QA-fail → budget/hang, then FIFO. **Batch approve** is allowed only for **same-type low-stakes**
    items (e.g. several story `Draft → Approved`), **never** for plan-gate or QA decisions.
  - **[v0.2] Interrupts** front-and-center **only** for a **watch-closely** block or a **fully-starved
    fleet** — defined as *"no agent can make progress without a human decision."* Note this is trivially
    true in single-agent v0.0/v0.1 (so the interrupt distinction only becomes meaningful at fleet
    concurrency, **v1**). This same surface becomes the **mobile push + inbox** later (§3.7).
- **Blocked-agent policy:** on block, the branch/worktree is preserved; the PTY is **parked** if cheap or
  **checkpointed and killed** if it holds resources; on approval it resumes/re-dispatches from story
  context.
- **Starvation signal:** when the fleet is idle waiting on the human, surface it (badge + optional push).

### 6.4 Hang, budget & runaway control
- **v0.0:** a **global manual kill-switch** + a **per-dispatch wall-clock timeout** → `Blocked`/escalate.
  Deterministic and buildable. (A hung single agent must not stall the loop.)
- **Deferred:** the **"no-meaningful-progress" heuristic is explicitly *not* built yet** (it's genuinely
  hard — thinking/slow-test/download all look hung from outside). v0/v1 use **wall-clock only**; the
  heuristic is a later research item.
- **v1:** hard **budget caps** (per story/run/daily) + **retry ceilings** wired to cost + **real token
  measurement** (parse `claude`/provider usage, keyed per agent/model/provider — replacing ADE's
  wall-clock cost *estimate*). *(The retry-ceiling **integer** itself is in v0 per §5; the cost-linked
  budgeting is v1.)*

---

## 7. BMAD integration & onboarding
- **Contract (v4, verified vs v4.44.3):** `.bmad-core/agents/*.md` (10 personas), `templates/*.yaml`
  (`owner`/`editors` section ownership), `tasks/*.md`, `core-config.yaml`, artifacts under `docs/`. All
  access via **`BmadAdapter`** (parse personas/templates/config; version-detect v4/v6). Per §5,
  **`BmadAdapter` ignores/strips the markdown `## Status`** (authoritative `Status` is the engine JSON,
  not co-owned with the template), and **section-ownership is best-effort in v0** (not hard-enforced on a
  `claude -p` agent).
- **Onboarding — one adaptive path (v0.0).** A single first-run flow serves both audiences (no hard
  fork), with a **"hints" toggle** (on for first-timers, off for the architect) that sprinkles short
  explainers — the seed that later grows into the teaching layer (§10). The flow:
  1. **Welcome / zero-state** — three entries: **New project (greenfield)** · **Open existing project
     (brownfield)** · **Try the sample**.
  2. **Setup (mostly automatic)** — prereq check (Claude Code installed? if not, guide the install) and a
     **one-time model-key entry → keychain** (§3.6: asked once per provider, re-prompted only on
     failure). Then **scaffold the bundled, pinned `.bmad-core` v4**.
  3. **Project**
     - *Try the sample* seeds a project that **ships a real failing-then-passing test and a declared
       verification command** (so §6.1 has something to run and v0.0 can demonstrate itself).
     - *New (greenfield)* opens an empty folder/repo and scaffolds `.bmad-core`; planning starts from
       scratch.
     - *Existing (brownfield)* — **the common real-world case.** Open a repo that already has code but no
       BMAD artifacts. Cadre runs BMAD's **`document-project`** task (the Architect **reads the actual
       codebase** and backfills `docs/architecture.md`: source tree, tech stack, existing patterns) so
       there is a real architecture to plan and verify against. It also **auto-detects the project's
       existing test command** (for the §6.1 verification gate) for the human to confirm. Then new scope
       is planned as a **brownfield PRD/epics** and the SM shards **brownfield stories**
       (`create-brownfield-story`) that reference existing code; the fleet's Dev agents **modify** the
       existing codebase rather than greenfield it. (BMAD ships full brownfield support:
       `brownfield-*` workflows + `document-project`.)
  4. **Land in the Planning Studio** — the phase stepper appears on `PLAN` with a single prompt: *"What do
     you want to build?"* (brownfield: *"What do you want to change or add?"*). You're now in the product.
  The **rich guided teaching** (gate rationale, worked examples, progression) is the *later* teaching
  layer (§10); v0.0 ships the adaptive flow + the hints hook only.
- **Onboarding failure paths (v0.0 robustness):**
  - **Not a git repo** (v0 is branch-per-story, §6.2) → offer `git init`, or refuse to proceed.
  - **`.bmad-core` already present** → if valid **v4**, reuse it; if **v6** (`_bmad/`+`config.toml`),
    **detect-and-refuse** (§3.4); otherwise warn, don't clobber.
  - **`docs/prd.md` / stories already exist** → treat as re-onboarding (load existing state), don't
    overwrite.
  - **Claude Code absent** → guide the install (step 2). **Invalid/expired key** → the §3.6 re-prompt
    loop. **Partial/failed scaffold** → roll back cleanly.
  - The pre-declared **sample verification command is still surfaced for human confirmation** at the PLAN
    gate (never silently trusted) — the sample seeds it; the human still confirms (§6.1).

---

## 8. Concrete changes to the ADE codebase
**Modify / rename:**
- `orchestratorStore.ts` → **`bmadStore.ts`** — *substantial rewrite*: disk-`Status` state machine (§5)
  reconciled from the engine-owned state file, with **write-origin suppression** so cadre's own writes
  don't self-trigger the watcher.
- `OrchestratorTab.tsx` → **Planning Studio** + **Fleet board**.
- `dispatchTask` → **`dispatchStory`** — spawn `claude -p` as the **direct PTY child** (not via login
  shell) in the story's **branch/worktree cwd**, persona + story as context.
- **Extend `create_pty` (Rust)** for (a) a per-spawn **`env` map** (ModelRouter seam) **and (b) an
  arbitrary direct-child command/argv** so `claude -p` is the PTY's direct child instead of a string
  typed into `$SHELL -l`, **and (c) surface the child's exit *code*** in `PtyEvent::Exit` (today it
  carries none) so process-exit is a clean completion signal (§3.1/§6.1). *(b)/(c) were missing from the
  earlier change list — they're prerequisites for the thesis.*
- Agent Dashboard → **Fleet Command Center**; replace wall-clock token *estimate* with **measured** usage
  (v1).

**Add (by milestone):**
- **[v0.0] New Rust commands:** **`run_verification(cwd, cmd, timeout) → {exit_code, stdout, stderr}`**
  (`std::process::Command::output()` — the thesis primitive; *no exit-code-capturing command exists
  today*) and a **git primitive** (`run_git`/reuse) for `checkout -b` and branch cwd targeting.
- **[v0.0]** `BmadAdapter`; **thin Rust engine module** = sole writer of `.cadre/state` + `.cadre/
  approvals` (§5); disk-`Status` reconciliation with **write-origin suppression** (record intended
  `{path, hash}`, ignore the matching watcher event); **file-drop `cadre-result` markers** under
  `.cadre/markers/` (§6.1); **completion & verification** (§6.1); **minimal approval/escalation** (flat
  list, §6.3); branch-per-story; `SecretsStore` (Anthropic key); BMAD scaffold onboarding + **a bundled
  test runner for the sample** (cadre ships no tests today — pick one); **manual kill-switch + wall-clock
  timeout** (§6.4); the **in-process engine command/event interface** (§3.7).
- **[v0.1]** Reviewer pass + full 5-persona planning walk.
- **[v0.2]** QA/Quinn persona gate atop verification; retry-ceiling wiring on QA-fail bounce.
- **[v0.3]** DB viewer (`sqlx` + `mongodb` commands) + DB Connections manager + DB-password path in
  `SecretsStore` — independent track.
- **[v1]** parallel worktrees + **integration-merge queue** (§6.2); `OrchestratorLoop` auto-delegation
  (policy B) at concurrency > 1; full **budget/runaway + real cost** (§6.4); `ContextStore`; sub-agent
  grid.
- **[later]** `ModelRouter` (after §3.3 spike); **engine network transport + mobile + relay/sharing**
  (§3.7); SSH; log viewer; themes; v6; orchestrator-lead; teaching layer (§10).

**Keep (exist):** terminals/tabs/splits, `FileBrowser`, Monaco `EditorTab`, `PreviewPanel` (+Mermaid),
`pty.rs`, `useTerminal`, `watcher.rs`, agent tracker.

**Remove / defer (all present — real work):** recording/player, voice (`Scratchpad`), `Tour`, detached
windows (**entangled with the PTY `reattach` path — remove carefully**), the ~26 generic profiles (incl.
Interview Coach / LinkedIn), browser tab.

---

## 9. Scope — staged

**v0.0 — walking skeleton** (prove *idea → PRD → one story → verified Done*; Claude-only, single agent,
human-dispatched, local):
`BmadAdapter` + **scaffold with a runnable sample test** · disk-`Status` reconciliation (atomic,
engine-owned, self-trigger-suppressed) · **PLAN + SHARD gates** on one engine-owned approval primitive
(PLAN approval captures the **human-owned verification command**) · **Planning Studio (PM + Architect)**
→ prd + architecture · **`dispatchStory`** (one `claude -p` direct child, branch-per-story, watchable) ·
**§6.1 verification** (engine runs the test, writes `Done`) · `create_pty` env seam · `SecretsStore`
(Anthropic key) · in-process engine interface · **manual kill-switch + wall-clock timeout** · Workbench
file/code/preview (as-is).

**v0.1 — quality of planning & review:** full **Analyst→PM→Architect→UX→PO** walk · **Reviewer** pass ·
**rich Plan viewer** (outline + sharded-doc tree + traceability links) · **plan annotations** (highlight
→ comment → scoped re-planning, anchored to section id + quoted snippet, persisted as a decision record).

**v0.2 — the full gate:** **QA/Quinn** persona gate atop verification · retry-ceiling on QA-fail bounce ·
richer escalation inbox.

**v0.3 — Workbench DB viewer** (independent track): `sqlx` + `mongodb` + DB Connections + DB-password
secrets.

**v1 — make it a fleet:** parallel worktrees + integration-merge queue · auto-delegation (policy B) at
concurrency > 1 · full budget/runaway + real cost measurement · `ContextStore` · sub-agent grid.

**later:** multi-model routing (**after the spike**) · **engine + clients pillar** (network transport,
**mobile full control**, **relay/sync + project sharing**, per-collaborator permissions, multi-actor
coordination — a second, cloud product) · SSH · logs · themes · v6 · orchestrator-lead · **teaching
layer** (§10).

---

## 10. Academy / teaching layer (designed later, sketched now)
Enforcement ≠ instruction. A later milestone adds: **gate rationale** ("why architecture before code"),
**explained failures** (why a verify/QA gate failed + what good looks like), **worked examples** (a good
PRD/architecture to compare against), a **guided first project** (the scaffold as a hand-held run), and
**progression** (a learner *earns* "let-it-run"). Until then, v0/v1 are honestly architect-first.

---

## 11. Name (resolved)
**Cadre.** A *trained, disciplined core group* — the disciplined-fleet soul in one word. Chosen over the
prior working name `aride` (read as "arid"; ambiguous pronunciation) and over `Keel` (dropped:
direct dev-tool collisions — [keel.so](https://keel.so) backend platform + [keel.sh](https://keel.sh)
k8s tool + npm `keel` taken).
- **Spoken brand:** **Cadre** (full form "Cadre IDE" when disambiguation is needed).
- **CLI:** `cadre` (short — `cadre plan`, `cadre fleet`). If npm `cadre` is taken, publish as `cadre-ide`
  with the installed **binary still named `cadre`**.
- **GitHub org / repos:** `cadre-ide` (disambiguates from unrelated Cadres — real estate, recruiting,
  logistics, NASA JPL robotics; none in developer tooling, so the CLI category is clear).
- **Domain:** `cadre.dev` (preferred) or `cadre-ide.dev` fallback (`cadre.com` is real-estate).
- **Tagline:** "the OS for agentic development."
- *To verify before public launch: `github.com/cadre-ide` free; npm `cadre` free (else `@cadre-ide/*`).*

---

## 12. Review findings & resolutions

**Rev 2 (first review):** B1 idle→§6.1; B2 parallel git→§6.2 worktrees; B3 approval→§6.3; B4 hang/cost→
§6.4; M1 forgeable Status→system-authoritative + atomic; M2 multi-model corrected & deferred; M3/M4
scope→staged; M5 academy→§10; M6 framing→§2.

**Rev 3 (second review):**
- **BLOCKER · verification-command trust** → §6.1: human-owned, PLAN-approved, engine-side; auto-detect
  is a suggestion the human confirms; scaffold ships a runnable test (§7).
- **BLOCKER · v0 not "smallest"** → §9 staged **v0.0→v0.3**; DB viewer → v0.3; personas subset to
  **PM+Architect** in v0.0; **Reviewer→v0.1, QA→v0.2** (the old "one Dev→Reviewer→QA agent" was three).
- **Approval theater** → §6.3 **process separation** (engine sole writer; state/approvals outside agent
  worktrees), signing dropped.
- **Status write-race** → §5 authoritative `Status` in an **engine-only file**, not the agent markdown.
- **§3.7 API over-claim** → v0 is an **in-process serializable command/event interface, not a network
  server**; "clients are peers" is a *later* property.
- **§6.4 milestone mismatch** → v0.0 gets manual kill-switch + wall-clock; "no-meaningful-progress"
  heuristic deferred; retry-ceiling integer kept in v0 (§5).
- **watcher self-trigger** → write-origin suppression in the reconciler (§5/§8).
- **`claude -p` as direct PTY child** → §3.3/§6.1/§8.
- **Integration-merge serialization** → §6.2 single-writer queue, defined at v1.
- **Minors** → no-tests/flaky/slow verification paths (§6.1); "redirect" defined (§6.3);
  ContextStore-write-failure is v1 not v0 (§3.5/§5); ModelRouter interface(v0 seam)-vs-module(later)
  clarified (§3.3).

**Rev 3.2 (third review — build-readiness + consistency; verdict: ready-with-gaps):**
- **Verification runner missing** → §8/§6.1 add the net-new Rust `run_verification` (exit-code capture;
  none existed).
- **Marker via PTY-scraping** → §6.1 **file-drop markers** (`.cadre/markers/`) via the watcher.
- **"Direct PTY child" unlisted** → §8 extends `create_pty` for arbitrary child command + exit code +
  git primitive.
- **Status dual-source-of-truth** → §5/§7 **fully externalize Status**; `BmadAdapter` ignores markdown
  `## Status`; section-ownership best-effort in v0; **engine state-owner is a thin Rust module**.
- **write-origin suppression undefined** → §5 mechanism (record `{path, hash}`, ignore matching event);
  board reads engine JSON.
- **Consistency/tags:** Plan viewer is **v0.1** (v0.0 reuses `PreviewPanel` as-is) — §4.1; inbox tagged
  **v0.0 flat / v0.2 rich** + "fully-starved" defined + priority + batch — §6.3; §5.1 **v0.1 honesty
  note** (impact/bounce are v1); §5 **`Done → Approved` re-open** edge; **resolved comments frozen** —
  §4.1; **onboarding failure paths** — §7.

**Earned (all reviews):** M2 multi-model rigor, M5/M6 honesty, idle-demotion, atomic system-authoritative
Status (verification trust model called "airtight"), the escalation inbox, and §8's candor that
`bmadStore` is a rewrite.

---

## 13. Success criteria (v0.0)
- From a cold start (incl. **BMAD scaffold with a runnable sample test**), a **PM+Architect** planning
  conversation produces valid `prd.md` + `architecture.md`; "Dispatch" stays disabled until both exist,
  a **human approval marker** is written, **and the human has confirmed the verification command**.
- The SM produces a context-engineered story; `Draft→Approved` requires human approval.
- Dispatching spawns a **watchable `claude -p` PTY (direct child) in the story's branch** implementing it
  TDD-first.
- A story reaches `Done` **only after the cadre engine itself runs the confirmed verification command
  green**; agent self-reports never set `Done`; the authoritative `Status` is written by the engine to
  its own state file; the board reflects it live with no watcher self-trigger.
- A no-test story can complete via an explicit **"verification not applicable — human-attested"** path.
- The **manual kill-switch** stops any run; a wall-clock timeout moves a stuck agent to `Blocked`.
- The escalation inbox shows every blocked-on-human item with one-click approve/reject/redirect.
- The Workbench browses files, views generated code, and previews PRD/architecture without leaving cadre.

---

## 14. Risks & mitigations
- **Verification command wrong/gamed** → human-owned & approved, engine-side, un-writable by agents;
  auto-detect only suggests.
- **Non-Claude tool-use fidelity** (later) → spike first; per-route validation; Claude fallback. Out of
  v0/v1.
- **`bmadStore` + reconciliation + verification are the critical path and multi-week, sequential** →
  build them first as the spine; treat as new work, not a rename; that *is* v0.0.
- **BMAD upstream churn** → couple only to the artifact contract; pin/bundle v4.
- **Discipline feels heavy / autonomy dial drains the thesis** → keep gates meaningful and fast; make
  "let-it-run" a *demonstrated* privilege (academy); measure whether users disable gates.
- **Scope creep back to "everything-app"** → §9 staging + §8 cut list are standing guardrails; the DB
  viewer is fenced to v0.3 as an independent track.
- **Engine + clients pillar is a second (cloud) product** → v0 reserves only the **in-process** seam (no
  network); ship the transport/mobile/relay/collaboration later with its own threat model.
- **Supply chain (LiteLLM, community Tauri plugins)** → pin; prefer thin direct wrappers; vet before
  bundling.
