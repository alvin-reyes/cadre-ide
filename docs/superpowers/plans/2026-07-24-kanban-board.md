# Kanban Board + Extensive Definition of Done — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the Shard/Fleet views with a single engine-driven **Kanban board** (Backlog → In Progress → QA → Completed, epic swimlanes, story cards, an "Auto-execute" action), and make every story carry an **extensive Definition of Done**.

**Architecture:** The board is a *visualization* of Cadre's existing engine status machine — cards flow automatically as the engine updates status; a user can NEVER drag a card to Completed (only the engine, on the frozen verification passing, moves it there). "Auto-execute" wires to the existing `dispatchReady()`. Each story gains a first-class `definitionOfDone: string[]` the SM must always populate, rendered in the story file and on each card.

**Tech Stack:** React 19 + TS, Zustand, Vitest, Tauri.

## Global Constraints

- Preserve all 317 frontend tests + tsc + build green after every task.
- **Status is engine-owned.** The board never sets a "Done"/"InReview" status directly — it only triggers dispatch (`dispatchReady`/`dispatchStory`); the engine moves cards. NO drag-to-Completed. NO manual status edits from the board.
- Column mapping (single source of truth, a pure function): Backlog ← `Draft`/`Approved`; In Progress ← `InProgress`; QA ← `InReview`; Completed ← `Done`. `Failed`/`Blocked` render in **Backlog** with an alert badge + re-run (they are re-dispatchable).
- Do not lose FleetView's existing capabilities: the **fleet model picker** and the **live per-task agent-output drill-in**. Reuse them in the board.
- Errors via `reportError`. The DoD must be REQUIRED in the story tool schema (a story without one is invalid).

---

## File Structure

- `src/lib/planning/storyTool.ts` — add `definitionOfDone` to the create-story + backlog tool schemas (required) and mandate it in the descriptions.
- `src/lib/engine/shard.ts` — `StoryContent.definitionOfDone`, a `## Definition of Done` section in `composeStoryFile`, and `parseDefinitionOfDone`.
- `src/cadre/useCadre.ts` — strengthen `SM_SYSTEM_PROMPT` to mandate an extensive DoD; thread `definitionOfDone` through `generateStory`/`shardNextStory` mapping.
- `src/lib/engine/kanban.ts` *(new)* — pure `statusColumn(status)` + `isAttention(status)` mapping. Unit-tested.
- `src/cadre/KanbanBoard.tsx` *(new)* — the board (columns, epic swimlanes, cards, DoD expand, auto-execute + per-card execute, shard controls, model picker, card drill-in).
- `src/cadre/CadreApp.tsx` — render `<KanbanBoard/>` for `SHARD` and `FLEET` phases instead of `<FleetView .../>`.

---

## Task 1: Extensive Definition of Done in the story model

**Files:** `src/lib/planning/storyTool.ts`, `src/lib/engine/shard.ts` (+ `shard.test.ts`), `src/cadre/useCadre.ts` (`SM_SYSTEM_PROMPT`), `src/lib/planning/generateStory.ts`.

**Interfaces — Produces:** `StoryContent.definitionOfDone: string[]`; `parseDefinitionOfDone(markdown: string): string[]`.

- [ ] **Step 1: Schema.** In `storyTool.ts` `CREATE_STORY_TOOL.input_schema.properties`, add:
  ```ts
  definitionOfDone: {
    type: "array", items: { type: "string" },
    description: "An EXTENSIVE Definition of Done — the full checklist that must ALL be true before this task is complete: every acceptance criterion met AND covered by a passing test; edge/error cases handled; no regressions; docs/comments updated; and the project's frozen verification command green. Be thorough — several concrete, checkable items, not one line.",
  },
  ```
  Add `"definitionOfDone"` to `required`. `CREATE_BACKLOG_TOOL` spreads `CREATE_STORY_TOOL.input_schema.properties` (confirm) so it inherits; ensure the per-story `required` there includes it too. Strengthen `CREATE_BACKLOG_TOOL`'s description to note every story must carry an extensive DoD.
- [ ] **Step 2: Map it.** In `storyTool.ts` where the tool input → story content (the `strList(...)` mapping, ~line 122), add `definitionOfDone: strList(i.definitionOfDone, "definitionOfDone")`.
- [ ] **Step 3: `StoryContent` + compose.** In `shard.ts`, add `definitionOfDone: string[]` to `StoryContent`. In `composeStoryFile`, after the `## Acceptance Criteria` block, add:
  ```
  ## Definition of Done

  - [ ] {each item}
  ```
  (a checkbox list, same style as Tasks). Destructure `definitionOfDone` in the function.
- [ ] **Step 4: Parse it back.** Add `export function parseDefinitionOfDone(markdown: string): string[]` mirroring `parseStoryFiles` but matching `## Definition of Done` (strip `- [ ]`/`- [x]`/`-`/`*` prefixes; drop empties).
- [ ] **Step 5: SM prompt.** In `useCadre.ts` `SM_SYSTEM_PROMPT`, add a sentence: "Every story MUST include an extensive Definition of Done — a thorough, checkable list (acceptance criteria met and test-covered, edge cases, no regressions, docs, and the frozen verification command green). A story without a real DoD is incomplete."
- [ ] **Step 6: Passthrough.** Ensure `generateStory.ts`/`shardNextStory` carry `definitionOfDone` from the tool output into `composeStoryFile` (follow how `acceptanceCriteria` flows — if the mapping is centralized in `storyTool`, no change needed here; verify).
- [ ] **Step 7: Tests** (`shard.test.ts`): `composeStoryFile` output contains `## Definition of Done` + each item as a checkbox; `parseDefinitionOfDone(composeStoryFile(x))` round-trips the list; a multi-item DoD survives. If `storyTool` has tests, assert `definitionOfDone` is required + mapped.
- [ ] **Step 8: Verify** `npx tsc --noEmit && npx vitest run` green (317 + new). Update any story-content fixture/test that constructs `StoryContent` without `definitionOfDone` (tsc will flag them).
- [ ] **Step 9: Commit** — `feat(story): extensive Definition of Done on every story (schema + compose/parse + SM prompt)`

## Task 2: The Kanban board component

**Files:** Create `src/lib/engine/kanban.ts` (+ `kanban.test.ts`) and `src/cadre/KanbanBoard.tsx`. Read `src/cadre/FleetView.tsx` first — reuse its model picker + live task-detail drill-in.

- [ ] **Step 1: Pure column mapping + test.** `kanban.ts`:
  ```ts
  export type KanbanColumn = "backlog" | "inProgress" | "qa" | "completed";
  export const KANBAN_COLUMNS: { id: KanbanColumn; label: string }[] = [
    { id: "backlog", label: "Backlog" }, { id: "inProgress", label: "In Progress" },
    { id: "qa", label: "QA" }, { id: "completed", label: "Completed" },
  ];
  export function statusColumn(status: Status): KanbanColumn; // Draft/Approved/Failed/Blocked→backlog, InProgress→inProgress, InReview→qa, Done→completed
  export function isAttention(status: Status): boolean;       // Failed | Blocked
  ```
  Test every status → the right column + `isAttention`.
- [ ] **Step 2: Board component.** `KanbanBoard.tsx`:
  - Read `stories` (StoryCard[]) + `epics` (from `parseEpics(prd)` like FleetView) from the stores. Group stories into **epic swimlanes** (one horizontal lane per epic; a story with no matching epic falls into a default lane). Within each lane, render the 4 columns; place each story card in `statusColumn(card.status)`.
  - **Card:** epic.story id, title (strip any `[phase]` tag or show it as a chip), a status badge (reuse FleetView's `stateInfo`), an alert style when `isAttention`. Click/expand → show the story's **Definition of Done** (fetch via `getStoryMarkdown(epic,story)` + `parseDefinitionOfDone`, cache per card) and, for `InProgress`/`InReview` cards, the **live agent-output drill-in** (reuse the same task-detail component/logs FleetView uses — extract it if needed).
  - **Header controls:** the shard controls (epic selector + repo selector + "Shard next story" `shardNextStory` + "Shard backlog" `shardBacklog` — add cards to Backlog), an **"Auto-execute"** button → `dispatchReady()` (dispatches all Backlog `Approved`/`Failed`; disabled while none ready or preview), and the fleet **model picker** (reuse `FleetModelPicker`). Per-card **"Execute"/"Re-run"** button on Backlog cards → `dispatchStory(epic, story)`.
  - **Engine-owned:** NO drag handlers that change status; NO manual move to QA/Completed. A short helper caption: "Cards move when the engine verifies — you can't drag a task to Done."
  - Use `--c-*` tokens; match FleetView's visual language. Handle the empty/preview state (no project → columns visible, actions gated, like FleetView).
- [ ] **Step 3: Verify** `npx tsc --noEmit && npx vitest run` (kanban.ts tests) + `npm run build`. (The component itself is validated by build + the manual checklist; the pure mapping is unit-tested.)
- [ ] **Step 4: Commit** — `feat(kanban): engine-driven Kanban board — swimlanes, columns, DoD cards, auto-execute`

## Task 3: Unify Shard + Fleet — mount the board

**Files:** `src/cadre/CadreApp.tsx`.

- [ ] **Step 1: Mount.** Replace the SHARD/FLEET render (`{phase === "PLAN" ? <PlanningStudio/> : <FleetView key=… mode=… />}`, ~line 173-176) so that for `SHARD` and `FLEET` phases it renders `<KanbanBoard />` (one board for both phases). Keep `PlanningStudio` for `PLAN`. Remove the now-unused `FleetView` import IF nothing else uses it (grep first; if the model-picker/drill-in were extracted into shared components in Task 2, FleetView may be deletable — but do NOT delete it in this task if anything still imports it; just stop mounting it).
- [ ] **Step 2: Phase behavior.** The PhaseStepper still shows SHARD/FLEET; both now show the same board. Confirm navigating SHARD↔FLEET keeps the board mounted/consistent (the board reads the same stores). No change to the phase enum or unlock logic.
- [ ] **Step 3: Verify** `npx tsc --noEmit && npx vitest run && npm run build` green.
- [ ] **Step 4: Manual checklist (human):** approve a plan → SHARD shows the empty board → "Shard backlog" fills Backlog with story cards in epic swimlanes → each card shows an extensive Definition of Done → "Auto-execute" moves cards to In Progress, then QA, then Completed on their own as the engine verifies → a Failed card sits in Backlog with an alert + Re-run → confirm you cannot drag a card to Completed.
- [ ] **Step 5: Commit** — `feat(kanban): unify Shard + Fleet into the Kanban board`

---

## Self-Review

**Spec coverage:** Kanban columns + swimlanes + cards → Task 2. Auto-execute + per-card execute → Task 2 (wraps existing dispatch). Engine-owned movement (no drag-to-Done) → Global Constraints + Task 2. Extensive DoD on every task → Task 1 (schema required + SM prompt + compose/parse) + shown on cards (Task 2). Unify Shard+Fleet → Task 3. ✓

**Type consistency:** `StoryContent.definitionOfDone`/`parseDefinitionOfDone` (Task 1) used by the card (Task 2). `statusColumn`/`KanbanColumn`/`isAttention` (Task 2) consumed by the board + Task 3. `Status` reused from `src/lib/engine/status.ts`.

**Engine-owned invariant:** the board only calls `dispatchReady`/`dispatchStory`; it never writes a status. Cards reflect the engine's status; movement to QA/Completed is impossible by hand. (Global Constraints, Task 2 Step 2.)

**Placeholder scan:** exact files, schema field, section titles, column mapping, and the reuse of FleetView's model-picker/drill-in named. Verify `CREATE_BACKLOG_TOOL`'s property-spread + required list when adding the DoD field (Task 1 Step 1).
