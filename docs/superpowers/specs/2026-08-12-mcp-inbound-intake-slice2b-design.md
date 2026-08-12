# MCP Inbound Intake — Slice 2b (Design)

**Date:** 2026-08-12
**Status:** Approved for planning
**Builds on:** Slice 1 (Connections), Slice 2 (outbound tracker sync), Slice 3 (CLI). Related: `[[tracker-integration-idea]]`.

## Problem

Slice 2 gave the *outbound* half — Cadre pushes verified status to the tracker. Slice 2b closes the loop with *inbound intake*: a tracker ticket flows INTO Cadre as work to plan→shard→build. The framing (from `[[tracker-integration-idea]]`) holds: **the tracker owns intake, Cadre owns execution truth.** "Your Jira/ClickUp ticket, planned and built and verified by Cadre, with status pushed back."

## Decisions settled

- **Ticket → brief → full plan.** The fetched ticket becomes a *brief* fed to the existing planning flow (`cmdPlan` on the CLI: PM → PRD, Architect → architecture + verify; then shard → stories). Maximum reuse of the planning brain; a small ticket just yields a small plan.
- **Both faces.** CLI `cadre intake <ticketId>` and a desktop "Import from tracker" action.
- **Agent-mediated**, mirroring Slice 2 outbound — a bounded agent reads the ticket via the connected tracker MCP; the engine owns the deterministic bookkeeping.

## Architecture

Four units.

### 1. Pure core — `src/lib/integrations/mcpIntake.ts`

No Tauri/zustand/SDK — reused by both faces. Owns the fetch *intent*, parsing, and the ticket→brief mapping.

```ts
export interface FetchedTicket { id: string; title: string; description?: string; acceptanceCriteria?: string; url?: string; }

/** Instruct the agent to READ one ticket by id/key from the connected tracker
 *  and return it as strict JSON. Read-only intent; no mutation. */
export function buildFetchPrompt(ticketRef: string): string;

/** Extract the ticket JSON from the agent reply (reuse the balanced-object
 *  scanner shared with parseSyncResult). Throws if no object with a non-empty
 *  id + title. */
export function parseTicket(raw: string): FetchedTicket;

/** Compose the brief string handed to the planning flow: title + description +
 *  acceptance criteria, framed as a change brief, with a provenance footer
 *  "(imported from tracker <id>)". Pure + deterministic. */
export function ticketToBrief(ticket: FetchedTicket): string;
```

The balanced-brace JSON scanner currently lives in `mcpTracker.ts` (`parseSyncResult`); **extract it to a shared pure helper** (e.g. `src/lib/integrations/jsonScan.ts` `lastJsonObject(raw)`) and have both `parseSyncResult` and `parseTicket` use it (drift/one-implementation, same discipline as Slice 3's `mergeGitignore`).

### 2. Link-back — extend the tracker id-map

`.cadre/mcp-tracker.json` gains an `epics` section so an imported ticket is remembered against the epic it produced:

```jsonc
{ "version": 1, "connectionId": "clickup",
  "tasks": { "1.2": { "taskId": "…" } },
  "epics": { "1": { "ticketId": "TCK-42", "url": "https://…" } } }   // NEW
}
```

Pure helpers in `mcpTracker.ts` (bump the file `version`? — no; keep `version:1`, `epics` optional so old files still parse): `recordEpicLink(file, epic, {ticketId,url})`, `epicTicket(file, epic)`. `trackerFromFile` tolerates a missing `epics` (defaults `{}`).

> **Scope note (follow-up, not this slice):** wiring OUTBOUND sync to update the *parent ticket* (vs. creating a per-story task) for stories under a linked epic is a refinement (Slice 2b.1). Slice 2b RECORDS the link and surfaces it; it does not change outbound's per-story behavior yet. This keeps the fan-out semantics (1 ticket → 1 epic → N stories → N tasks) out of scope for now — flagged explicitly so it's a deliberate boundary, not a silent gap.

### 3. CLI — `cadre intake <ticketId> [projectDir]`

`src/cli/mcp/intakeNode.ts` + a `cmdIntake` in `cadre.ts`:
- `resolveTrackerEnvNode(io, root)` → null (no tracker) → error + exit 1 ("designate a tracker: cadre connect <preset> --as-tracker").
- `runFetchAgentNode({ prompt: buildFetchPrompt(ticketId), mcpConfigPath, env, serverKey, cwd })` — spawn `claude -p <prompt> --mcp-config <tracker.mcp.json> --allowedTools mcp__<id>__*`, **bounded by the same timeout** as the sync agent (a hung fetch must not hang intake), capture stdout. (Reuse/parallel `realRunSyncAgentNode`.)
- `parseTicket(stdout)` → `ticketToBrief` → `cmdPlan(brief, projectDir)` (reuse verbatim — produces PRD + architecture + plan approval). On plan success, `recordEpicLink` for epic `1` (cmdPlan/shard use epic 1) with the ticket id → write `.cadre/mcp-tracker.json`.
- Print progress; NEVER print a secret. Fetch/parse failure → clear error + exit 1 (intake is user-initiated, so a failure IS a hard error here — unlike best-effort outbound sync).
- Then the user runs `cadre shard` + `cadre run` (or `cadre intake … --auto` chains shard+approve+run like `cadre build`). MVP: `cadre intake <id>` does plan + records link; `--build` flag chains shard→approve→run.

### 4. Desktop — "Import from tracker"

- `src/stores/mcpIntakeStore.ts`: `fetchTicket(root, ticketId) → Promise<FetchedTicket>` — resolves the tracker env (`useConnectionsStore.resolveTrackerEnv`), spawns the fetch agent (same bounded, least-privilege claude spawn as `mcpTrackerStore.runSyncAgent`), `parseTicket`. Errors → `reportError` + reject (surfaced in the UI).
- UI: an **"Import from tracker"** control on the planning surface (a small button + ticket-id input; enabled only when a tracker connection is designated). On submit → `fetchTicket` → **pre-fill the plan composer** with `ticketToBrief(ticket)` (so the human reviews + sends → the normal plan flow, honoring Cadre's deliberate plan sign-off). On the resulting plan, `recordEpicLink`.
- Human-in-the-loop by design: intake pre-fills, it does not auto-run the plan on desktop (matches the "plan sign-off is a deliberate action" guardrail). The CLI is the headless path.

## Data flow

```
cadre intake TCK-42 ~/proj                    Desktop: Import from tracker (TCK-42)
  resolveTrackerEnv → tracker.mcp.json+env      resolveTrackerEnv → …
  fetch agent: claude -p buildFetchPrompt         fetchTicket (same spawn)
      --mcp-config … --allowedTools mcp__id__*    parseTicket → FetchedTicket
  parseTicket → FetchedTicket                     pre-fill plan composer with ticketToBrief
  ticketToBrief → brief → cmdPlan(brief)          (human reviews + runs plan)
  recordEpicLink(epic 1, {ticketId,url})          recordEpicLink on plan
  → docs/prd.md, architecture, plan.json          → normal PLAN board
```

## Safety

- **Read-only intent:** the fetch agent's prompt instructs it to READ the ticket and return JSON only — no mutation. (MCP tracker tools include writes; we can't enforce read-only generically, so the prompt scopes it. Low-risk for a fetch; noted as a limitation, same posture as the outbound sync agent.)
- **Bounded:** the fetch agent has the same hard timeout as the sync agent — a hung fetch aborts with a clear error, never hangs.
- **Least privilege:** `--allowedTools mcp__<id>__*` only; NOT `--dangerously-skip-permissions`.
- **Secrets keychain-only** (Slice-1 invariant): tracker config `${VAR}` placeholders + child-env injection; no secret in files/args/logs.
- **Intake failure is loud** (unlike outbound sync): a user asked for it, so a fetch/parse error is a hard error surfaced to them, not a silent warning.

## Testing strategy

- **Pure core (vitest):** `buildFetchPrompt` (contains the ticket ref, demands strict JSON, read-only wording), `parseTicket` (extracts nested/prose-wrapped JSON via the shared scanner, throws on missing id/title), `ticketToBrief` (title+description+acceptance+provenance footer), `recordEpicLink`/`epicTicket` round-trip, `trackerFromFile` tolerates missing `epics`. Shared `lastJsonObject` unit tests; `parseSyncResult` still green after the extraction.
- **CLI (vitest, in-memory NodeIo + stub fetch agent):** intake with a stub ticket JSON → `cmdPlan` invoked with the derived brief (mock the planning call) → epic link written; no tracker → error; fetch-agent reject/timeout → hard error, no partial plan.
- **Desktop store (vitest):** `fetchTicket` with a mocked spawn returns a parsed ticket; a rejecting/timeout spawn → `reportError` + reject; secret never in any spawned arg.
- **Demo/e2e:** `mockBackend` returns a canned fetch-agent transcript for the fetch invocation; e2e drives "Import from tracker" → pre-filled composer; zero console errors.

## Non-goals (Slice 2b)

- No outbound change (parent-ticket-vs-per-story-task fan-out = Slice 2b.1 follow-up).
- No ticket LIST/browse UI — intake is by explicit ticket id (a `cadre tickets` / picker is a later nicety).
- No auto-run of the plan on desktop (deliberate human sign-off).
- No enforced read-only tool scoping (prompt-scoped, same as the sync agent).

## Open confirmations (non-blocking)

- Where the desktop "Import from tracker" control lives — the planning surface (PlanningStudio) is the natural home; confirm the composer-prefill seam at build time.
- Epic numbering: `cmdPlan`/`shard` use epic `1`; `recordEpicLink` keys on that. If a project accrues multiple plans/epics, keying will need the real epic id — confirm against how shard assigns epics.
