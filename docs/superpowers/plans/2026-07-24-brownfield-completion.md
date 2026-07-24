# Brownfield Onboarding Completion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Complete Cadre's brownfield onboarding so the analysis it generates actually drives planning for every role (A), works across a multi-repo project (B), and is polished + tested (C).

**Architecture:** Brownfield onboarding already generates a 2-pass as-is analysis (`documentProject` in `brownfield.ts` → `docs/brownfield-analysis.md`) and shows it to the PM. This plan (1) propagates that analysis to the Architect, DevOps, Designer, Scrum Master, and Dev fleet; (2) generalizes `documentProject` to analyze each registered repo (`parseRepos`) and auto-detect each repo's verify command; (3) fixes the analyzing-spinner race and adds test coverage.

**Tech Stack:** React 19 + TS, Zustand, Vitest, Tauri.

## Global Constraints

- Preserve all 264 frontend tests + tsc clean + `npm run build` green after every task.
- `projectContext` (the store field holding `docs/brownfield-analysis.md`'s content) is empty for greenfield projects — every injection must be conditional on it being non-empty, so greenfield behavior is byte-for-byte unchanged.
- `parseRepos(manifestJson)` always returns ≥1 `RepoRef {id,name,path,verify?}` (default `{id:"root",name,path:"."}`), so the multi-repo path must also handle the single-default-repo case identically to today.
- Errors surface via `reportError`. `.cadre/` stays engine-owned.
- Multi-repo analysis writes each repo's brief to that repo's own `docs/brownfield-analysis.md` (committable with the repo); the store aggregates them into `projectContext`.

---

## Task 1: Propagate the brownfield analysis to every planning + fleet role

**Problem:** `projectContext` (the as-is analysis) is injected ONLY into the PM system prompt (`PlanningStudio.tsx:427-439`). The Architect/DevOps/Designer design against the PRD only, the Scrum Master shards blind, and the Dev fleet never receives it. The analysis is generated then mostly ignored.

**Files:** `src/cadre/PlanningStudio.tsx`, `src/cadre/useCadre.ts`.

- [ ] **Step 1: Architect/DevOps/Designer/TechWriter see the analysis.** In `PlanningStudio.tsx` `systemPromptFor` (the block ending `return prd.trim() ? \`${base}\n\n## PRD (context)\n${prd}\` : base;`), also append the brownfield analysis when present. Read `projectContext` (already a selector in this component — confirm; if not, add `const projectContext = useCadre((s) => s.projectContext);`). Change the return to append, after the PRD block, when `projectContext.trim()`:
  `\n\n## Existing project analysis (brownfield — design to fit what already exists)\n${projectContext}`.
  Use the SAME heading text the PM block uses for consistency. This must apply to architect, devops, design, and techwriter (all go through this `base` return).
- [ ] **Step 2: Scrum Master sees the analysis.** In `useCadre.ts`, `shardNextStory` and `shardBacklog` build `planContext` (search `const planContext =` — ~line 548). When `get().projectContext.trim()` is non-empty, append `\n\n---\n\n# Existing project analysis (brownfield)\n\n${projectContext}` to `planContext` in BOTH functions. So sharded stories reference real file paths/patterns.
- [ ] **Step 3: Dev fleet sees the analysis.** In `useCadre.ts` `loadSharedContext(root)` (~line 270), after the ADR block and before `return files`, read `${root}/${BROWNFIELD_DOC_PATH}` (`.catch(() => "")`); if non-empty, `files.push({ path: BROWNFIELD_DOC_PATH, content })`. (`BROWNFIELD_DOC_PATH` is already imported.) Bound it like the ADRs are NOT needed — a single analysis file is fine; but if it's very large, cap to e.g. first 16000 chars with a truncation note to protect the argv. Keep it simple: inject as-is (the file is one bounded doc).
- [ ] **Step 4: Verify.** `npx tsc --noEmit && npx vitest run` green (264). If any existing test snapshots a system prompt or planContext, update it. Prompt-injection wiring isn't unit-tested here (matches the existing PM injection, which is untested) — the whole-branch review covers correctness.
- [ ] **Step 5: Commit** — `git commit -am "feat(brownfield): propagate the as-is analysis to Architect/DevOps/SM/Dev"`

## Task 2: Fix the analyzing-spinner race

**Problem:** `BrownfieldOnboard`'s `analyzing={!!busy}` (`PlanningStudio.tsx:665`) is driven by the GLOBAL `busy` field, so any other background op that sets `busy` (approve, dispatch) makes the onboard screen show "Reading the codebase…" incorrectly.

**Files:** `src/lib/engine/projectSlices.ts` (or wherever the CadreSlice lives), `src/cadre/useCadre.ts`, `src/cadre/PlanningStudio.tsx`.

- [ ] **Step 1: Add a dedicated flag.** Add `analyzingBrownfield: boolean` to the slice (`CadreSlice` interface + `emptyCadreSlice()` default `false` + `mirrorCadre()` — mirror how an existing boolean like `needsReplan` is handled across those three).
- [ ] **Step 2: Set it in `documentProject`.** In `useCadre.ts` `documentProject()`, set `analyzingBrownfield: true` alongside the `busy` set at the start, and `analyzingBrownfield: false` in BOTH the success and error paths (wherever `busy: null` is set).
- [ ] **Step 3: Gate the UI on it.** In `PlanningStudio.tsx`, add `const analyzingBrownfield = useCadre((s) => s.analyzingBrownfield);` and change the `BrownfieldOnboard` prop to `analyzing={analyzingBrownfield}`. Leave `disabled` keyed on `busy` (so the button is still disabled during any busy state).
- [ ] **Step 4: Verify** `npx tsc --noEmit && npx vitest run` green.
- [ ] **Step 5: Commit** — `git commit -am "fix(brownfield): dedicated analyzing flag so the spinner doesn't race other busy states"`

## Task 3: Multi-repo brownfield analysis + per-repo verify detection

**Problem:** `documentProject()` analyzes only the single Cadre root; a polyrepo project's registered repos are never read, and per-repo verify commands aren't auto-detected. Also `documentProject` is entirely untested.

**Files:** `src/cadre/useCadre.ts`, `src/lib/engine/brownfield.ts`, `src/cadre/useCadre.test.ts` (or a new focused test), `src/cadre/PlanningStudio.tsx` (per-repo progress copy, minor).

**Interfaces — Consumes:** `parseRepos(manifestJson): RepoRef[]` and `resolveRepoPath(projectRoot, path): string` from `src/lib/engine/repos.ts`; `useRepos.getState().setVerify(root, repoId, cmd)` from `reposStore.ts`; `detectProjectVerify(root)` (currently in `useCadre.ts` ~line 249) — extract/reuse per repo.

- [ ] **Step 1: Extract a testable orchestrator.** Refactor the body of `documentProject()` into an injectable helper so it can be unit-tested without Tauri. Create in `brownfield.ts` (pure/DI, no store):
  ```ts
  export interface OnboardRepo { id: string; name: string; path: string; } // path already resolved (absolute)
  export interface DocumentAllInput { repos: OnboardRepo[]; passes?: number; model?: string; env?: Record<string,string>; }
  export interface DocumentAllDeps extends DocumentProjectDeps {
    detectVerify: (repoRoot: string) => Promise<string | null>;
    onRepoStart?: (repo: OnboardRepo, index: number, total: number) => void;
  }
  export interface RepoAnalysis { id: string; name: string; path: string; analysis: string; detectedVerify: string | null; }
  export async function documentAllRepos(deps: DocumentAllDeps, input: DocumentAllInput): Promise<RepoAnalysis[]>;
  ```
  `documentAllRepos` iterates repos; for each, calls `onRepoStart`, runs the existing `documentProject(deps, { root: repo.path, passes, model, env })` (which writes that repo's `docs/brownfield-analysis.md` and returns its content), and `deps.detectVerify(repo.path)`. Returns one `RepoAnalysis` per repo. A repo that throws is captured as `{ ...repo, analysis: "", detectedVerify: null }` (don't abort the whole run — log via a per-repo error the caller can surface) — OR rethrow; pick fail-soft (continue) and let the caller report. Keep `documentProject` (single-repo) exported and unchanged; `documentAllRepos` composes it.
- [ ] **Step 2: Compose the aggregate.** Add `export function composeAggregateAnalysis(analyses: RepoAnalysis[]): string` — for a single repo return its `analysis` verbatim (unchanged single-repo behavior); for multiple, join with `## Repo: {name} (\`{path}\`)\n\n{analysis}` sections under a top `# Project analysis (N repos)` header.
- [ ] **Step 3: Unit tests** (`brownfield.test.ts` additions): `documentAllRepos` with a fake deps — (a) single repo → one analysis, `onRepoStart` called once, aggregate == the single analysis; (b) two repos → two analyses in order, `detectVerify` called per repo, `onRepoStart` called twice with (index,total); (c) a repo whose `spawnAgent`/`waitForExit` fails → captured as empty analysis, the OTHER repo still analyzed. `composeAggregateAnalysis` single vs multi formatting.
- [ ] **Step 4: Wire the store.** In `useCadre.ts` `documentProject()`: read the manifest (`read_file ${root}/cadre.json`, tolerant), `const repos = parseRepos(manifest)`, resolve each path via `resolveRepoPath(root, r.path)`. Call `documentAllRepos(tauriBrownfieldDeps(onOutput), { repos: resolved, passes: 2, model, env })` where `onRepoStart` prefixes the stream with `\n\n=== Analyzing {name} ({i+1}/{total}) ===\n` (so the single log shows per-repo progress). After: `projectContext = composeAggregateAnalysis(results)`; for each result with a `detectedVerify`, call `useRepos.getState().setVerify(root, id, detectedVerify)` (persists to cadre.json → seeds `repoVerifyDrafts`); keep setting the single `detectedVerify` state from the FIRST/default repo so the single-repo verify field still pre-fills. Also write the aggregate to `${root}/${BROWNFIELD_DOC_PATH}` so hydrate restores it. Set `analyzingBrownfield`/`busy` per Task 2.
  - If `detectProjectVerify` is currently a private function bound to the active root, generalize it to take an explicit `repoRoot` and pass it as `deps.detectVerify`.
- [ ] **Step 5: Minor UI copy.** In `PlanningStudio.tsx`, the `BrownfieldOnboard` step 1 desc can stay; no structural UI change required (the per-repo progress shows in the existing streamed `output`). Optional: if `multiRepo`, tweak the intro copy to say it reads "each repo". Keep minimal.
- [ ] **Step 6: Verify** `npx tsc --noEmit && npx vitest run && npm run build` green (264 + new tests).
- [ ] **Step 7: Manual checklist (human):** open an existing single repo → Analyze → brief written, verify pre-filled, PM/Architect/SM all reference it. Register a 2nd repo → re-analyze → both repos analyzed, each repo's `docs/brownfield-analysis.md` written, per-repo verify fields pre-filled, aggregate brief has both sections.
- [ ] **Step 8: Commit** — `git commit -am "feat(brownfield): multi-repo analysis + per-repo verify detection (testable orchestrator)"`

---

## Self-Review

**Spec coverage:** A (propagation) → Task 1. C (race + tests) → Task 2 + Task 3 Step 3. B (multi-repo + per-repo verify) → Task 3. ✓

**Type consistency:** `OnboardRepo`/`DocumentAllDeps`/`RepoAnalysis`/`documentAllRepos`/`composeAggregateAnalysis` defined in Task 3 Step 1-2 and used in Step 3-4. `parseRepos`/`resolveRepoPath`/`RepoRef` reused from `repos.ts`. `BROWNFIELD_DOC_PATH` reused.

**Backward-compat:** every injection guards on `projectContext.trim()` (greenfield unchanged); `documentAllRepos` on the default single repo behaves like today (`composeAggregateAnalysis` returns the lone analysis verbatim; `detectVerify` on `.` == current behavior).

**Placeholder scan:** none — exact files, functions, injection points, and test cases named.
