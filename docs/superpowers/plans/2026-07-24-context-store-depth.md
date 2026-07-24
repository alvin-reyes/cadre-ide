# Context Store Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn the free-form `.cadre/context/*.md` Context Store into structured, durable **decision memory** — Architecture Decision Records (ADRs) that agents read and write, and a UI to browse it — so parallel/large builds stop re-litigating settled decisions.

**Architecture:** ADRs are numbered markdown files under `.cadre/context/decisions/NNNN-slug.md` with a standard template (Status · Context · Decision · Consequences) and a lifecycle (Proposed → Accepted → Superseded). A pure `adr.ts` module composes/parses/numbers them. `loadSharedContext` also injects the decisions into every dispatched agent; the Dev prompt + `CLAUDE.md` instruct agents to record significant choices as ADRs and consult existing ones. A Context view in the UI (dock rail) browses and renders the Context Store files + ADRs, and lets a human add/edit them.

**Tech Stack:** React 19 + TS, Zustand, Vitest, Tauri (file read/write/list commands, already present).

## Global Constraints

- Preserve all 227 frontend tests + Rust green after every task.
- ADRs live at `.cadre/context/decisions/NNNN-slug.md` (zero-padded to 4 digits). They ARE part of the Context Store and get committed (they're the shareable record), same as `.cadre/context/*.md`.
- Backward-compat: a project with no `decisions/` dir behaves exactly as today; `loadSharedContext` tolerates its absence.
- The `adr.ts` module is pure + dependency-injected (like other `src/lib/engine` modules) — no Tauri/store imports.
- Errors surface via `reportError`.

---

## File Structure

- `src/lib/engine/adr.ts` *(new)* — pure: `Adr` type, `ADR_DECISIONS_DIR`, `adrFilename`, `nextAdrNumber`, `composeAdr`, `parseAdr`, `parseAdrIndex`. Unit-tested.
- `src/cadre/useCadre.ts` — `loadSharedContext` also reads `.cadre/context/decisions/*.md` and injects them (so agents see prior decisions).
- `src/lib/planning/personas.ts` (`DEV_SYSTEM_PROMPT`) + `src/lib/projectScaffold.ts` (`CLAUDE.md`) — instruct ADR discipline (record decisions, consult existing).
- `src/stores/contextStore.ts` *(new)* — load the Context Store files + ADRs for the UI; add/edit an ADR; add/edit a context file. Wraps Tauri file commands.
- `src/cadre/ContextView.tsx` *(new)* — the browse/read/edit UI, mounted as a 4th main view via the dock rail.
- `src/cadre/CadreApp.tsx`, `src/cadre/components/DockRail.tsx` — add the "Context" view + rail item.

---

## Task 1: `adr.ts` — the pure ADR model

**Files:** Create `src/lib/engine/adr.ts` + `adr.test.ts`.

**Interfaces — Produces:**
```ts
export const ADR_DECISIONS_DIR = ".cadre/context/decisions";
export type AdrStatus = "Proposed" | "Accepted" | "Superseded";
export interface Adr {
  number: number;
  title: string;
  status: AdrStatus;
  date: string;         // YYYY-MM-DD (caller supplies; keep pure)
  context: string;
  decision: string;
  consequences: string;
}
export function adrFilename(number: number, title: string): string; // `${DIR}/0001-slug.md` (4-digit, slugified title; reuse shard.ts slugify)
export function nextAdrNumber(existingNumbers: number[]): number;    // max+1, or 1
export function composeAdr(adr: Adr): string;   // the standard ADR markdown
export function parseAdr(markdown: string): Adr | null;  // parse back (tolerant; null if not an ADR)
export function parseAdrIndex(filenames: string[]): { number: number; slug: string }[]; // from a list of NNNN-slug.md names
```

- [ ] **Step 1: Write failing tests** (`adr.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { adrFilename, nextAdrNumber, composeAdr, parseAdr, parseAdrIndex, ADR_DECISIONS_DIR, type Adr } from "./adr";

const sample: Adr = { number: 2, title: "Use Postgres", status: "Accepted", date: "2026-07-24",
  context: "We need durable storage.", decision: "Adopt Postgres.", consequences: "Ops must run a DB." };

describe("adr", () => {
  it("filenames are zero-padded + slugified under the decisions dir", () => {
    expect(adrFilename(2, "Use Postgres")).toBe(`${ADR_DECISIONS_DIR}/0002-use-postgres.md`);
    expect(adrFilename(13, "Async Job Queue!")).toBe(`${ADR_DECISIONS_DIR}/0013-async-job-queue.md`);
  });
  it("nextAdrNumber is max+1 (or 1 when empty)", () => {
    expect(nextAdrNumber([1, 2, 5])).toBe(6);
    expect(nextAdrNumber([])).toBe(1);
  });
  it("composeAdr round-trips through parseAdr", () => {
    const md = composeAdr(sample);
    expect(md).toContain("# 2. Use Postgres");
    expect(md).toContain("Accepted");
    const back = parseAdr(md);
    expect(back).toMatchObject({ number: 2, title: "Use Postgres", status: "Accepted",
      context: "We need durable storage.", decision: "Adopt Postgres.", consequences: "Ops must run a DB." });
  });
  it("parseAdr returns null for non-ADR markdown", () => {
    expect(parseAdr("# Just a doc\n\nnope")).toBeNull();
  });
  it("parseAdrIndex reads number+slug from filenames, sorted", () => {
    expect(parseAdrIndex(["0002-b.md", "0001-a.md", "readme.md"])).toEqual([
      { number: 1, slug: "a" }, { number: 2, slug: "b" },
    ]);
  });
});
```

- [ ] **Step 2: Run — FAIL.** `npx vitest run src/lib/engine/adr.test.ts`
- [ ] **Step 3: Implement `adr.ts`** — `composeAdr` emits: `# {n}. {title}`, then `## Status` / `{status}`, `## Context` / `{context}`, `## Decision` / `{decision}`, `## Consequences` / `{consequences}` (a `_Date: {date}_` line under the title). `parseAdr` matches the `# {n}. {title}` heading (return null if absent) and extracts each section by its `## ` heading (reuse a section-extract regex like `shard.ts`'s `parseStoryFiles`). `adrFilename` uses `slugify` from `shard.ts`. `nextAdrNumber` = `(Math.max(0, ...existing) + 1)`. `parseAdrIndex` matches `/^(\d+)-(.+)\.md$/`, sorts by number.
- [ ] **Step 4: Run — PASS.** `npx vitest run src/lib/engine/adr.test.ts && npx tsc --noEmit`
- [ ] **Step 5: Commit** — `git commit -am "feat(context): pure ADR model (compose/parse/number)"`

## Task 2: Agents read + write ADRs

**Files:** `src/cadre/useCadre.ts` (`loadSharedContext`), `src/lib/planning/personas.ts` (`DEV_SYSTEM_PROMPT`), `src/lib/projectScaffold.ts` (`CLAUDE.md`).

- [ ] **Step 1: `loadSharedContext` injects the decisions.** After it reads `.cadre/context/*.md`, also list `.cadre/context/decisions` (tolerant of absence via `.catch`) and push each `*.md` as an `AlwaysFile` with path `.cadre/context/decisions/{name}`. Keep it bounded — these are small. So every dispatched agent sees prior ADRs alongside the contracts + journal.
- [ ] **Step 2: `DEV_SYSTEM_PROMPT`** — add: "When you make a significant architectural or cross-cutting decision (a technology, pattern, contract, or trade-off other stories depend on), record it as an ADR: a new file `.cadre/context/decisions/NNNN-slug.md` with `## Status` (Accepted), `## Context`, `## Decision`, `## Consequences`. Before diverging from an existing decision, read the ADRs already in `.cadre/context/decisions/` and follow them — do not silently re-decide."
- [ ] **Step 3: `CLAUDE.md` (projectScaffold.ts)** — add the same guidance to the constitution's Context Store section (mention `.cadre/context/decisions/` as the ADR log agents read first and append to).
- [ ] **Step 4: Verify** `npx tsc --noEmit && npx vitest run` green (227). If a scaffold test asserts CLAUDE.md content, update it.
- [ ] **Step 5: Commit** — `git commit -am "feat(context): inject ADRs into agents; ADR discipline in Dev prompt + constitution"`

## Task 3: The Context view (browse / add / edit)

**Files:** Create `src/stores/contextStore.ts` + `src/cadre/ContextView.tsx`; modify `src/cadre/CadreApp.tsx` + `src/cadre/components/DockRail.tsx`.

- [ ] **Step 1: `contextStore.ts`** — `useContextStore` with `entries: { path: string; content: string; kind: "context" | "adr" }[]`, `load(root)` (read `.cadre/context/*.md` + `.cadre/context/decisions/*.md`, tag kind, parse ADRs for title/status via `parseAdr`), `saveFile(root, path, content)` (write via `write_text_file`), `newAdr(root, {title, context, decision, consequences})` (compute `nextAdrNumber` from existing, `composeAdr` with today's date passed in, write `adrFilename(...)`, reload). Pure list-merge helpers can be extracted + tested; the Tauri glue need not be unit-tested (mirror `reposStore.ts`).
- [ ] **Step 2: `ContextView.tsx`** — a two-pane view: a left list of entries (contracts + ADRs, ADRs showing `#N title [Status]`), a right pane rendering the selected file (reuse `Markdown`), with an "Edit" toggle (textarea → `saveFile`) and a "New ADR" form (title + the three sections → `newAdr`). Reuse `--c-*` tokens + the `MonacoWrapper`/`Markdown` patterns already in the codebase. Load on mount / when `projectRoot` changes.
- [ ] **Step 3: Mount as a 4th main view.** In `CadreApp.tsx`, extend `MainView` to include `"context"`; render `<ContextView/>` under the same `hidden(...)` pattern as the other views; add a "Context" item to `DockRail` (a fitting lucide icon, e.g. `Library` or `BookText`). Load the context store when the view opens.
- [ ] **Step 4: Verify** `npx tsc --noEmit && npx vitest run && npm run build` green.
- [ ] **Step 5: Manual checklist (human):** open the Context view → see existing `.cadre/context/*.md`; add a New ADR → confirm `.cadre/context/decisions/0001-*.md` is written and appears with its status; edit a context file → confirm it persists; dispatch a story → confirm the agent's prompt includes the ADRs (spot-check via the AI Log / the dispatched prompt).
- [ ] **Step 6: Commit** — `git commit -am "feat(context): Context view — browse, add ADRs, edit the Context Store"`

---

## Self-Review

**Spec coverage:** ADRs (structured decision records) → Task 1 (model) + Task 3 (author in UI). Agents read + write them → Task 2 (inject + prompt) + Task 3 (`newAdr`). UI to surface → Task 3. ✓

**Type consistency:** `Adr`/`AdrStatus`/`ADR_DECISIONS_DIR`/`adrFilename`/`nextAdrNumber`/`composeAdr`/`parseAdr`/`parseAdrIndex` used identically across tasks; `slugify` reused from `shard.ts`.

**Backward-compat:** no `decisions/` dir → `loadSharedContext` `.catch` skips it (Task 2 Step 1); the Context view lists whatever exists; existing Context Store `.md` files render unchanged.

**Placeholder scan:** none — Task 1 fully coded/tested; Tasks 2–3 name exact files, the injection point, the prompt text intent, and the UI panes, gated by build + the manual checklist. (ADR dates are passed in by the caller to keep `adr.ts` pure — `newAdr` supplies `new Date()` at the store layer.)
