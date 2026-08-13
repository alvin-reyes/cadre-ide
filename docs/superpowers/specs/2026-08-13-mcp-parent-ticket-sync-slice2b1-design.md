# MCP Parent-Ticket Sync — Slice 2b.1 (Design)

**Date:** 2026-08-13
**Status:** Approved for planning
**Builds on:** Slice 2 (outbound sync), Slice 2b (inbound intake + `epics` link). Related: `[[tracker-integration-idea]]`.

## Problem

Slice 2b imports a ticket → an epic and records the `epics: {<epic>: {ticketId}}` link. But outbound sync (Slice 2) still creates a **per-story** task for every story — so a story under an imported epic spawns a NEW tracker task, fragmenting the one ticket the user imported into N unrelated tasks. Slice 2b.1 fixes the fan-out: for a story under a **linked** epic, sync updates the **parent ticket** (aggregate status + a progress comment) instead of creating a per-story task. One ticket → one tracking unit.

## Decision settled

**Aggregate status + progress comment.** The parent ticket's status = the epic's rollup; each transition adds a short comment. No per-story tasks for linked epics. Generic across any tracker (no subtask dependency).

## Architecture

### 1. Pure core (`src/lib/integrations/mcpTracker.ts`)

```ts
/** Epic rollup for the parent ticket. Pure.
 *   all Done                         → "Done"
 *   else any Blocked/Failed          → "Blocked"
 *   else any InProgress/InReview     → "InProgress"
 *   else (all Draft/Approved / empty)→ null  (nothing to report yet) */
export function aggregateEpicStatus(statuses: TrackerStatus[]): TrackerStatus | null;

/** The instruction to UPDATE a parent ticket (not create a task): set ticket
 *  <ticketId> to <aggregateStatus>; add a comment "Cadre: story <e.s> → <status>
 *  (<done>/<total> done)"; on Done cite the frozen verify command. Demands the
 *  same strict-JSON {"taskId","url"} reply (taskId echoes the ticket id). */
export function buildEpicSyncPrompt(input: {
  ticketId: string; epic: number; aggregateStatus: TrackerStatus;
  changedStory: string; changedStatus: TrackerStatus; doneCount: number; totalCount: number;
  verifyCmd?: string;
}): string;
```

### 2. Sync routing (both faces)

`syncStory` (desktop) / `syncStoryNode` (CLI) gain the epic's story statuses so they can compute the rollup. After reading `.cadre/mcp-tracker.json`:

```
const ticket = epicTicket(file, story.epic);
if (ticket && epicStatuses) {                      // LINKED epic → parent-ticket sync
  const agg = aggregateEpicStatus(epicStatuses.map(s => s.status));
  if (agg === null) return;                        // all Draft/Approved: nothing to report
  prompt = buildEpicSyncPrompt({ ticketId: ticket.ticketId, epic, aggregateStatus: agg,
                                 changedStory: taskKey(story), changedStatus: status,
                                 doneCount, totalCount, verifyCmd });
  raw = await runAgent(prompt);                    // updates the parent ticket
  // DO NOT write file.tasks[storyKey] — the epic link IS the tracking record.
  // (Optionally refresh epicTicket.url from the reply.)
} else {                                            // UNLINKED epic → today's per-story task
  … existing behavior, unchanged …
}
```

**Signature:** add an optional trailing param `epicStatuses?: { epic: number; story: number; status: TrackerStatus }[]` to `syncStory`/`syncStoryNode`. Existing callers still compile; when omitted, behavior is exactly today's (per-story). The new callers pass the epic's stories.

**Per-root serialization (Slice 2) already protects this:** N stories under one epic all target the same parent ticket, serialized per project, so no clobber — each transition advances the ticket to the current rollup.

### 3. Callers pass the epic's statuses

- **Desktop** `bmadStore.setStatus`: it already holds `get().projects[root].stories` — filter to the changed story's epic → `[{epic,story,status}]` → pass to `syncStory`.
- **CLI** the `syncingSetStatus` wrapper (`cadre.ts`): `readBoard(root)` → filter the epic → pass to `syncStoryNode`.

### 4. Close the deferred desktop epic-link (so 2b.1 works on desktop)

Slice 2b left desktop intake NOT recording the epic link (only the CLI does). Without a link, 2b.1's parent-ticket path never triggers for desktop-imported tickets. So: on a successful desktop **Import from tracker**, record `recordEpicLink(file, 1, { ticketId, url })` to `.cadre/mcp-tracker.json` (epic `1`, symmetric with the CLI's `cmdIntake`, which records epic 1 at plan time). A store helper `recordEpicLinkFor(root, epic, link)` (read→record→write, ENOENT→empty, transient-read→abort per the I1 discipline) does the write; the import handler calls it after a successful fetch.

## Data flow

```
story 1.2 → Done  (engine transition)
  setStatus/wrapper: epicStatuses = board stories where epic==1  → syncStory(root, {1.2}, Done, verifyCmd, epicStatuses)
    ticket = epicTicket(file, 1)                → { ticketId: "TCK-42" }
    agg = aggregateEpicStatus([Done, InProgress, Done]) → "InProgress"   (not all done yet)
    buildEpicSyncPrompt(TCK-42, InProgress, "1.2→Done (2/3 done)")
    agent updates ticket TCK-42 → status InProgress + comment
  … when the LAST story hits Done → agg = "Done" → ticket TCK-42 → Done (verify cmd cited)
```

## Safety / invariants (unchanged from Slice 2)

- Sync never blocks/fails the engine transition (best-effort; errors → reportError / CLI warning).
- Least-privilege agent (`--allowedTools mcp__<id>__*`, no skip-permissions), bounded by the sync timeout.
- Secrets keychain-only. Per-root serialization preserved. I1 read discipline preserved (ENOENT→empty; transient read → abort, no overwrite).
- **No duplicate top-level tasks** for linked epics (the whole point): the per-story `tasks` map is NOT written for a linked-epic story.

## Testing strategy

- **Pure:** `aggregateEpicStatus` (all-Done→Done; any-Blocked/Failed→Blocked; any-active→InProgress; all-Draft/Approved/empty→null; mixed precedence: Blocked wins over InProgress when not all Done); `buildEpicSyncPrompt` (contains ticketId, aggregate status, `<e.s>→<status>`, `<done>/<total>`, verify cmd on Done, strict-JSON demand).
- **Desktop `syncStory`:** linked epic → agent gets the EPIC prompt (ticketId + aggregate), `file.tasks[storyKey]` is NOT written; unlinked epic → per-story behavior unchanged (regression guard); `agg===null` → no agent call; the desktop import records the epic link.
- **CLI `syncStoryNode`:** same three cases; the `syncingSetStatus` wrapper passes the epic's board statuses.
- Existing Slice-2 sync tests (unlinked) must stay green.

## Non-goals (Slice 2b.1)

- No subtask creation (aggregate-status model chosen).
- Multi-epic projects still key the desktop link on epic 1 (matches the CLI's current assumption); real multi-epic keying is the same open item flagged in Slice 2b.
- No new demo/e2e assertion for the aggregate (needs a real multi-story epic + transitions; covered by unit tests + noted manual verification) — the sync agent path is already demo-mocked.

## Open confirmations (non-blocking)

- Whether a linked-epic story should ALSO leave a breadcrumb in `tasks` (e.g. `{parentTicket: ticketId}`) for observability — MVP writes nothing to `tasks` for linked stories; revisit if the board UI wants to show "synced to ticket".
