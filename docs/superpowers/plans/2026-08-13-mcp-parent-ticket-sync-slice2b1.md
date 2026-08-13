# MCP Parent-Ticket Sync — Slice 2b.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For a story under an imported (linked) epic, outbound sync updates the PARENT ticket to the epic's rollup status + a progress comment, instead of creating a per-story task.

**Architecture:** A pure `aggregateEpicStatus` + `buildEpicSyncPrompt`; `syncStory`/`syncStoryNode` gain an optional `epicStatuses` param and route to a parent-ticket update when `epicTicket(file, epic)` exists; callers pass the epic's board statuses; the desktop import records the epic link (closing the Slice-2b deferral).

**Tech Stack:** TypeScript, React 19, zustand, Tauri, Node, vitest. No new deps.

**Spec:** `docs/superpowers/specs/2026-08-13-mcp-parent-ticket-sync-slice2b1-design.md` (binding).

## Global Constraints

- **No per-story task for a linked epic:** when a story's epic has a linked ticket, sync updates the parent ticket and does NOT write `file.tasks[storyKey]`. Unlinked epics keep today's per-story behavior EXACTLY (regression guard).
- **Backward-compatible signature:** `epicStatuses` is an OPTIONAL trailing param; when omitted, behavior is exactly today's.
- **All Slice-2 invariants preserved:** sync never blocks the engine transition; least-privilege bounded agent; secrets keychain-only; per-root serialization; I1 read discipline (ENOENT→empty, transient read→abort, no overwrite).
- Pure modules import no zustand/Tauri. Each task green: `npx tsc --noEmit` (+ `-p tsconfig.cli.json` for CLI) + `npx vitest run <touched>`.

## File Structure

- Modify `src/lib/integrations/mcpTracker.ts` (+ test) — `aggregateEpicStatus`, `buildEpicSyncPrompt`.
- Modify `src/stores/mcpTrackerStore.ts` (+ test) — `syncStory` epic routing.
- Modify `src/stores/bmadStore.ts` — pass the epic's story statuses.
- Modify `src/stores/mcpIntakeStore.ts` (+ test) — `recordEpicLinkFor`; `src/cadre/PlanningStudio.tsx` — record link on import.
- Modify `src/cli/mcp/trackerSyncNode.ts` (+ test) — `syncStoryNode` epic routing; `src/cli/cadre.ts` — wrapper passes board statuses.

---

### Task 1: Pure aggregate + epic-sync prompt

**Files:** Modify `src/lib/integrations/mcpTracker.ts`, `src/lib/integrations/mcpTracker.test.ts`.

**Interfaces:**
```ts
export function aggregateEpicStatus(statuses: TrackerStatus[]): TrackerStatus | null;
export function buildEpicSyncPrompt(input: {
  ticketId: string; epic: number; aggregateStatus: TrackerStatus;
  changedStory: string; changedStatus: TrackerStatus; doneCount: number; totalCount: number; verifyCmd?: string;
}): string;
```

- [ ] **Step 1: Write the failing test**

```ts
import { aggregateEpicStatus, buildEpicSyncPrompt } from "./mcpTracker";

describe("aggregateEpicStatus", () => {
  it("all Done → Done", () => expect(aggregateEpicStatus(["Done","Done"])).toBe("Done"));
  it("any Blocked/Failed (not all done) → Blocked", () => {
    expect(aggregateEpicStatus(["Done","Blocked"])).toBe("Blocked");
    expect(aggregateEpicStatus(["InProgress","Failed"])).toBe("Blocked");
  });
  it("any active (no blocked, not all done) → InProgress", () => {
    expect(aggregateEpicStatus(["Done","InProgress"])).toBe("InProgress");
    expect(aggregateEpicStatus(["InReview","Draft"])).toBe("InProgress");
  });
  it("all Draft/Approved or empty → null", () => {
    expect(aggregateEpicStatus(["Draft","Approved"])).toBeNull();
    expect(aggregateEpicStatus([])).toBeNull();
  });
  it("Blocked wins over active when not all done", () => {
    expect(aggregateEpicStatus(["InProgress","Blocked","Done"])).toBe("Blocked");
  });
});

describe("buildEpicSyncPrompt", () => {
  it("names the ticket, aggregate status, the changed story + progress, demands strict JSON", () => {
    const p = buildEpicSyncPrompt({ ticketId: "TCK-42", epic: 1, aggregateStatus: "Done",
      changedStory: "1.2", changedStatus: "Done", doneCount: 3, totalCount: 3, verifyCmd: "npm test" });
    expect(p).toContain("TCK-42");
    expect(p).toContain("Done");
    expect(p).toContain("1.2");
    expect(p).toMatch(/3\s*\/\s*3|3 of 3/);
    expect(p).toContain("npm test");
    expect(p).toMatch(/update/i);           // update the ticket, not create
    expect(p).toMatch(/only.*json/i);
  });
});
```

- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement.** `aggregateEpicStatus`: `if (statuses.length && statuses.every(s => s==="Done")) return "Done"; if (statuses.some(s => s==="Blocked" || s==="Failed")) return "Blocked"; if (statuses.some(s => s==="InProgress" || s==="InReview")) return "InProgress"; return null;`. `buildEpicSyncPrompt`: an update instruction — "You have MCP tools for an external tracker. UPDATE ticket `<ticketId>` — set its status to `<aggregateStatus>` and add a comment: `Cadre: story <changedStory> → <changedStatus> (<doneCount>/<totalCount> done)`." + on Done with verifyCmd "the frozen verification command `<cmd>` passed." + "Reply with ONLY a JSON object {\"taskId\":\"<the ticket id>\",\"url\":\"…\"}."
- [ ] **Step 4: green (mcpTracker.test.ts + tsc). Step 5: Commit** — `feat(mcp): aggregateEpicStatus + buildEpicSyncPrompt (parent-ticket rollup)`

---

### Task 2: Desktop parent-ticket sync + link recording

**Files:** Modify `src/stores/mcpTrackerStore.ts` (+ test), `src/stores/bmadStore.ts`, `src/stores/mcpIntakeStore.ts` (+ test), `src/cadre/PlanningStudio.tsx`.

**2a — `syncStory` epic routing** (`mcpTrackerStore.ts`):
- Signature: `syncStory(root, story, status, verifyCmd?, epicStatuses?: { epic: number; story: number; status: TrackerStatus }[])`.
- Inside the serialized chain, after `readTrackerFile`: `const ticket = epicTicket(file, story.epic);`
  - If `ticket && epicStatuses`: `const forEpic = epicStatuses.filter(s => s.epic === story.epic).map(s => s.status); const agg = aggregateEpicStatus(forEpic); if (!agg) return;` build `buildEpicSyncPrompt({ ticketId: ticket.ticketId, epic: story.epic, aggregateStatus: agg, changedStory: taskKey(story), changedStatus: status, doneCount: forEpic.filter(s=>s==="Done").length, totalCount: forEpic.length, verifyCmd })`; run the agent; `parseSyncResult(raw)` (validates a taskId came back); **do NOT write `file.tasks[storyKey]`** (optionally refresh `epics[epic].url` if the reply has one, else leave the file unchanged — a no-op write is fine but prefer only writing when something changed). Return.
  - Else (no ticket or no epicStatuses): the EXISTING per-story path, unchanged.
- Import `epicTicket`, `aggregateEpicStatus`, `buildEpicSyncPrompt` from `mcpTracker`.

**2b — `bmadStore.setStatus` passes epic statuses:** where it calls `useMcpTrackerStore.getState().syncStory(...)`, also compute `const epicStatuses = (get().projects[root]?.stories ?? []).map(s => ({ epic: s.epic, story: s.story, status: s.status as TrackerStatus }))` and pass it as the 5th arg. (Pass ALL stories; syncStory filters by epic. Cheap.)

**2c — desktop records the epic link on import** (`mcpIntakeStore.ts` + `PlanningStudio.tsx`):
- Add store method `recordEpicLinkFor(root: string, epic: number, link: { ticketId: string; url?: string }): Promise<void>` — read `.cadre/mcp-tracker.json` via `invoke("read_file")` (ENOENT→`emptyTrackerFile(tracker connection id)`; transient read → abort per I1, `reportError` + return; malformed → abort); `recordEpicLink(file, epic, link)`; write via `write_text_file`. Never throws (reportError on failure). Needs the tracker connection id — get it from `resolveTrackerEnv(root)`'s serverKey, or read the existing file's connectionId.
- In `PlanningStudio.tsx`'s import handler, after `setDraft(ticketToBrief(ticket))`, call `useMcpIntakeStore.getState().recordEpicLinkFor(root, 1, { ticketId: ticket.id, url: ticket.url })` (epic 1, symmetric with the CLI). Best-effort (don't block the pre-fill).

**Tests:**
- `mcpTrackerStore.test.ts`: (i) linked epic + epicStatuses (mixed) → the agent prompt contains the ticketId + aggregate status; `file.tasks` has NO entry for the story key after; (ii) linked epic, all stories Draft/Approved (`agg===null`) → agent NOT called; (iii) UNLINKED epic → the existing per-story path runs (prompt is the per-story sync, `tasks[storyKey]` written) — regression guard; (iv) linked epic but `epicStatuses` omitted → falls back to per-story (back-compat).
- `mcpIntakeStore.test.ts`: `recordEpicLinkFor` writes the epic link (mock invoke); transient read → reportError + no overwrite; never throws.

- [ ] **Step 1: failing tests. Step 2: fail. Step 3: implement 2a/2b/2c. Step 4: green (`npx vitest run src/stores/mcpTrackerStore.test.ts src/stores/mcpIntakeStore.test.ts`, `npx tsc --noEmit`, full suite). Step 5: Commit** — `feat(mcp): desktop parent-ticket sync + import records epic link`

---

### Task 3: CLI parent-ticket sync

**Files:** Modify `src/cli/mcp/trackerSyncNode.ts` (+ test), `src/cli/cadre.ts`.

**3a — `syncStoryNode` epic routing** (`trackerSyncNode.ts`):
- Signature: add optional trailing `epicStatuses?: { epic: number; story: number; status: TrackerStatus }[]`.
- Same routing as desktop: `const ticket = epicTicket(file, story.epic);` if `ticket && epicStatuses` → aggregate → `buildEpicSyncPrompt` → run agent → parse → do NOT write `file.tasks[storyKey]`; else the existing per-story path. Preserve the I1 read discipline + never-throws.

**3b — the `syncingSetStatus` wrapper passes board statuses** (`cadre.ts`): where `syncTracker` (the wrapper's sync closure) calls `syncStoryNode`, first `const board = await readBoard(root); const epicStatuses = board.map(c => ({ epic: c.epic, story: c.story, status: c.status as TrackerStatus }));` and pass it. (readBoard is already used in cmdRun.) Keep it best-effort — a readBoard failure must not break the run (the whole sync is already swallowed).

**Tests (`trackerSyncNode.test.ts`):** linked epic + epicStatuses → epic prompt (ticketId + aggregate), no `tasks[storyKey]` write; `agg===null` → no agent call; unlinked epic → per-story path unchanged (regression); epicStatuses omitted → per-story fallback.

- [ ] **Step 1: failing tests. Step 2: fail. Step 3: implement 3a/3b. Step 4: green (`npx vitest run src/cli/mcp/trackerSyncNode.test.ts`, both tscs, full suite). Step 5: Commit** — `feat(cli): parent-ticket sync in cadre run`

---

## Self-Review

- **Spec coverage:** pure aggregate + epic prompt §1 (T1), sync routing §2 both faces (T2 desktop, T3 CLI), callers pass statuses §3 (T2b, T3b), desktop link recording §4 (T2c). ✓
- **Placeholder scan:** T1 full code+tests; T2/T3 exact routing + test lists reusing Slice-2 patterns. No vague steps.
- **Type consistency:** `aggregateEpicStatus`/`buildEpicSyncPrompt` (T1) consumed by T2a/T3a; `epicStatuses` shape identical across `syncStory`/`syncStoryNode` and both callers; `epicTicket`/`recordEpicLink` (Slice 2b) reused; `TrackerStatus` from `mcpTracker`.
- **Global constraints** (no per-story task for linked epics, back-compat optional param, per-root serialization + I1 preserved, never-blocks) enforced by T1 aggregate tests, T2/T3 "no tasks write for linked" + "unlinked unchanged" regression tests, and the untouched serialization/read-discipline code.
