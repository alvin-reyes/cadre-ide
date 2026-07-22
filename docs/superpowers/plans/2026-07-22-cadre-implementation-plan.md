# Cadre — Implementation Plan & Status

Consolidated inventory of what's built vs what remains, so "implement all" has a
map. Source of truth for scope: `docs/superpowers/specs/2026-07-21-cadre-design.md`.

**Legend:** ✅ built · 🟡 partial · ⬜ not started · 🔒 gated on validation

---

## Built (v0.0 engine + this session)

**Disciplined engine (Rust + TS, 135 TS + 27 Rust tests)**
- ✅ `run_verification` (process-group kill), `create_pty`, `cadre_state` (atomic, sole-writer), `SecretsStore` (keychain)
- ✅ `runStory` / `dispatchStory` / `verifyStory` / `runApprovedStory` (engine writes Done, never the agent)
- ✅ Board reconcile from committed files (reload-from-git), write-origin suppression
- ✅ 16-case e2e integration test of the whole loop

**Planning Studio (Opus)**
- ✅ PM · Architect · Designer chats (streaming, attachments, quick replies, Mermaid-rendered docs)
- ✅ PM-first / owner-summons model; hand-off; next-step guidance
- ✅ Adversarial review per artifact + resolve-findings + gated hand-off
- ✅ CTO sign-off gate with plan validation
- ✅ Brownfield onboarding (2-pass project analysis); New/Open home + folder picker + `cadre.json`

**Fleet (Sonnet)**
- ✅ Dispatch → live streamed output → engine verify → board (per-story)
- ✅ Multi-model routing (Claude/Kimi/DeepSeek), model self-heal fallback
- ✅ Adversarial **code-review fleet** (3 lens agent loops) + verdicts on cards
- ✅ Scope-change cascade + re-approval gate; phase gating

**Cockpit / IDE**
- ✅ Workbench (folder tree · code viewer · terminal), always-visible dock rail
- ✅ Team org chart with live status; token/cost meter; toasts; slideable divider; PDF export
- ✅ Warm-dark Anthropic theme, Inter/Newsreader type

---

## Remaining — sequenced ("implement all" = Phases A→G)

### Phase A — 🔒 Validate the live loop (GATE, do first)
Everything above is unit-tested but the **live SDK conversation + real `claude` dispatch have not run once**. Smoke-test in the native window (`npm run tauri dev`): PM streams → approve → dispatch → verified Done. Fix the first breakage (likely CLI model id for dispatch). **Nothing below is trustworthy until this passes.**

### Phase B — Review + QA fleet completion (v0.1/0.2)
- ⬜ Per-role **Definition of Done** carried by the role; SM composes story DoD
- ⬜ **Mandatory QA agent** + committed QA report (every AC ↔ engine-executed case)
- ⬜ Adversarial code review on **Opus** (currently Sonnet) + **auto-run** review as a gate (currently manual)
- ⬜ **Review-fleet visibility** panel (all artifacts' review state + running reviewers)

### Phase C — Human fleet (v0.1)
- ⬜ `assignee` on story state (agent | human), git identity
- ⬜ Claim / Verify for human workers (same frozen command); assignee chips; git-native sync

### Phase D — Unified comms hub
- ⬜ One view to reach every agent + see progress (planning threads + per-story fleet activity, status-aware)

### Phase E — Deploy & tool integrations (v1)
- ⬜ Integration registry (Railway/Fly/DO): agent prepares, **engine holds creds + runs deploy + health-checks**; deploy = a story whose verification is a health check; human-gated

### Phase F — Context Store (v1, anti-hallucination)
- ⬜ `.cadre/decisions/` ADRs (committed), agent memory, per-dispatch retrieval by pointer

### Phase G — Provider unification & Workbench depth
- ⬜ Single provider switch driving planning + fleet (Kimi 3 when available)
- ⬜ DB viewer (v0.3), SSH, log viewer

---

## Execution rule
Do phases **in order**, each ending in a working, validated slice. Phase A is a
hard gate. B is the highest product value (completes the discipline). C–G are
additive. Don't build two phases deep on an unvalidated base.
