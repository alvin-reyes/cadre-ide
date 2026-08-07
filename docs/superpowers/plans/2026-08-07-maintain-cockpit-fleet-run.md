# Maintain Cockpit — Staged Tasks → Fleet Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Maintain view so you stage a list of tasks (from a Prompts library + a Thoughts composer), then Run all to launch them as a live fleet of isolated-worktree subagents in a new Fleet tab — each card showing a status pulse, live output tail, and a maximize control.

**Architecture:** Pure logic (prompt helpers, task/batch reducers, batch orchestration) lives in `src/lib/maintain` with injected deps and Vitest tests, mirroring `dispatch.ts`/`tasks.ts`. State lives in a new global `promptsStore` (prompts are cross-project) and the existing per-project `CadreSlice` (staged tasks + batches). The batch orchestrator reuses the low-level `dispatchTask` engine and drives subagent status from the process via `waitForExit`. UI reuses `LiveTerminal` and the `PoolAgentNode` card pattern.

**Tech Stack:** TypeScript, React 19, Zustand, Vitest, Tauri (`invoke`), existing engine (`dispatchTask`, `tauriOrchestratorDeps`, `waitForExit`), existing components `LiveTerminal` (`agentShared.tsx`), the `TerminalTabs` tab pattern.

## Global Constraints

- Reuse the low-level engine: subagent dispatch MUST go through `dispatchTask` (`src/lib/engine/dispatchTask.ts`) — NEVER `runApprovedStory`/`dispatchStory` (those enforce the PLAN gate and need a sharded story + frozen verify).
- Style: `--c-*` CSS tokens, `lucide-react` icons, injected-deps testable seams, doc comments explaining *why*. Match the surrounding code's density and idiom.
- Pure logic is unit-tested with injected deps. UI wiring is verified by running the real app (the codebase has no React test harness).
- Subagent status is process-derived (`waitForExit`) — never self-reported. No verify/triage/PR-handoff in this slice.
- Batches are session-only (live PTYs die on quit). Only the staged list persists (per project).
- `npx tsc --noEmit` must stay green after every task.

---

### Task 1: Prompt model + built-in catalog

**Files:**
- Create: `src/lib/maintain/prompts.ts`
- Create: `src/lib/maintain/promptCatalog.ts`
- Test: `src/lib/maintain/prompts.test.ts`

**Interfaces:**
- Produces:
  - `type PromptCategory = "Testing" | "Refactor" | "Debug" | "Review" | "Git" | "Docs" | "Dependencies" | "Performance" | "Security"`
  - `interface Prompt { id: string; title: string; body: string; category: PromptCategory; builtin: boolean }`
  - `interface PromptGroup { category: PromptCategory | "Favorites"; prompts: Prompt[] }`
  - `searchPrompts(prompts: Prompt[], query: string): Prompt[]`
  - `groupByCategory(prompts: Prompt[], favoriteIds: string[]): PromptGroup[]`
  - `BUILTIN_PROMPTS: Prompt[]` (from `promptCatalog.ts`)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { searchPrompts, groupByCategory, type Prompt } from "./prompts";
import { BUILTIN_PROMPTS } from "./promptCatalog";

const P = (id: string, title: string, body: string, category: Prompt["category"]): Prompt =>
  ({ id, title, body, category, builtin: true });

describe("searchPrompts", () => {
  const list = [P("a", "Add a failing test", "write a test", "Testing"), P("b", "Bump deps", "upgrade", "Dependencies")];
  it("matches title case-insensitively", () => {
    expect(searchPrompts(list, "FAILING").map((p) => p.id)).toEqual(["a"]);
  });
  it("matches body", () => {
    expect(searchPrompts(list, "upgrade").map((p) => p.id)).toEqual(["b"]);
  });
  it("returns all on empty query", () => {
    expect(searchPrompts(list, "  ").length).toBe(2);
  });
});

describe("groupByCategory", () => {
  const list = [P("a", "t", "b", "Testing"), P("b", "r", "b", "Refactor"), P("c", "t2", "b", "Testing")];
  it("groups by category preserving order, categories with items only", () => {
    const groups = groupByCategory(list, []);
    expect(groups.map((g) => g.category)).toEqual(["Testing", "Refactor"]);
    expect(groups[0].prompts.map((p) => p.id)).toEqual(["a", "c"]);
  });
  it("floats favorites into a leading Favorites group (originals stay in place)", () => {
    const groups = groupByCategory(list, ["b"]);
    expect(groups[0].category).toBe("Favorites");
    expect(groups[0].prompts.map((p) => p.id)).toEqual(["b"]);
    expect(groups.find((g) => g.category === "Refactor")!.prompts.map((p) => p.id)).toEqual(["b"]);
  });
});

describe("BUILTIN_PROMPTS", () => {
  it("has >= 5 prompts in every category with unique ids", () => {
    const cats = ["Testing", "Refactor", "Debug", "Review", "Git", "Docs", "Dependencies", "Performance", "Security"] as const;
    for (const c of cats) expect(BUILTIN_PROMPTS.filter((p) => p.category === c).length).toBeGreaterThanOrEqual(5);
    expect(new Set(BUILTIN_PROMPTS.map((p) => p.id)).size).toBe(BUILTIN_PROMPTS.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/maintain/prompts.test.ts`
Expected: FAIL — cannot find `./prompts` / `./promptCatalog`.

- [ ] **Step 3: Write minimal implementation**

`src/lib/maintain/prompts.ts`:

```ts
/**
 * Prompt library model + pure helpers for the Maintain cockpit's intake.
 * A Prompt is a reusable task template. Helpers are pure so they unit-test
 * without a store; the store (promptsStore) owns persistence + CRUD.
 */

export type PromptCategory =
  | "Testing" | "Refactor" | "Debug" | "Review" | "Git"
  | "Docs" | "Dependencies" | "Performance" | "Security";

export interface Prompt {
  id: string;
  title: string;
  body: string;
  category: PromptCategory;
  builtin: boolean;
}

export interface PromptGroup {
  category: PromptCategory | "Favorites";
  prompts: Prompt[];
}

/** Category display order (also the group order). */
export const PROMPT_CATEGORIES: PromptCategory[] = [
  "Testing", "Refactor", "Debug", "Review", "Git",
  "Docs", "Dependencies", "Performance", "Security",
];

/** Case-insensitive substring match over title + body. Empty query → all. */
export function searchPrompts(prompts: Prompt[], query: string): Prompt[] {
  const q = query.trim().toLowerCase();
  if (!q) return prompts;
  return prompts.filter((p) => p.title.toLowerCase().includes(q) || p.body.toLowerCase().includes(q));
}

/**
 * Group prompts by category in PROMPT_CATEGORIES order, dropping empty groups.
 * Favorites (by id) are ALSO surfaced in a leading "Favorites" group; the
 * originals remain in their own category (a favorite shows twice, by design).
 */
export function groupByCategory(prompts: Prompt[], favoriteIds: string[]): PromptGroup[] {
  const groups: PromptGroup[] = [];
  const favSet = new Set(favoriteIds);
  const favs = prompts.filter((p) => favSet.has(p.id));
  if (favs.length) groups.push({ category: "Favorites", prompts: favs });
  for (const category of PROMPT_CATEGORIES) {
    const inCat = prompts.filter((p) => p.category === category);
    if (inCat.length) groups.push({ category, prompts: inCat });
  }
  return groups;
}
```

`src/lib/maintain/promptCatalog.ts` — author ≥ 5 real, useful prompts per category (stable slug ids like `test-add-failing`). Abbreviated shape (fill all 9 categories, ≥5 each):

```ts
import type { Prompt } from "./prompts";

const b = (id: string, title: string, body: string, category: Prompt["category"]): Prompt =>
  ({ id, title, body, category, builtin: true });

export const BUILTIN_PROMPTS: Prompt[] = [
  // ── Testing ──
  b("test-add-failing", "Add a failing test first", "Write a failing test that captures the desired behavior, then implement the minimal change to make it pass.", "Testing"),
  b("test-edge-cases", "Cover edge cases", "Add edge-case and boundary tests for the module I name, then fix any bugs they reveal.", "Testing"),
  b("test-flaky", "Stabilize a flaky test", "Find why the test I name is flaky (timing, order, shared state) and make it deterministic.", "Testing"),
  b("test-regression", "Regression test for a bug", "Write a regression test reproducing the described bug, confirm it fails, then fix the code.", "Testing"),
  b("test-coverage-gap", "Fill a coverage gap", "Identify untested branches in the file I name and add focused tests for them.", "Testing"),
  // ── Refactor ──
  b("refactor-extract", "Extract a function", "Extract the selected logic into a well-named function with a clear signature; keep behavior identical and tests green.", "Refactor"),
  b("refactor-rename", "Rename for clarity", "Rename the symbol I name across the codebase to something clearer; update all references.", "Refactor"),
  b("refactor-dedupe", "Remove duplication", "Find and collapse duplicated logic in the area I name into a single reused unit.", "Refactor"),
  b("refactor-split-file", "Split an oversized file", "Split the file I name by responsibility into focused modules; keep imports and behavior intact.", "Refactor"),
  b("refactor-simplify", "Simplify control flow", "Simplify the tangled control flow in the function I name without changing behavior; keep tests green.", "Refactor"),
  // ── Debug ──
  b("debug-repro", "Reproduce and isolate", "Reproduce the described failure with the smallest input, then isolate the root cause before changing code.", "Debug"),
  b("debug-stacktrace", "Explain a stack trace", "Walk the stack trace I paste, pinpoint the failing line, and propose the fix.", "Debug"),
  b("debug-bisect", "Bisect a regression", "Use git history to find the commit that introduced the described regression and explain why.", "Debug"),
  b("debug-logging", "Add targeted logging", "Add minimal, targeted logging to diagnose the described issue; remove it once the cause is found.", "Debug"),
  b("debug-race", "Hunt a race condition", "Investigate the described intermittent bug for a race/ordering issue and make access deterministic.", "Debug"),
  // ── Review ──
  b("review-correctness", "Review for correctness", "Review the current diff for correctness bugs — off-by-one, null/undefined, error paths — and list concrete failure scenarios.", "Review"),
  b("review-security", "Review for security", "Review the current diff for injection, authz, and secret-handling issues.", "Review"),
  b("review-simplify", "Review for simplification", "Review the current diff for reuse, dead code, and simpler equivalents.", "Review"),
  b("review-perf", "Review for performance", "Review the current diff for obvious performance regressions (N+1, needless allocation, sync I/O).", "Review"),
  b("review-tests", "Review test quality", "Review the tests in the current diff for missing cases and brittle assertions.", "Review"),
  // ── Git ──
  b("git-commit-msg", "Write a commit message", "Write a conventional-commit message for the currently staged changes.", "Git"),
  b("git-split-commits", "Split into logical commits", "Split the current working changes into focused, logical commits with good messages.", "Git"),
  b("git-pr-summary", "Summarize a branch for a PR", "Summarize this branch's changes into a PR title and body with rationale and test notes.", "Git"),
  b("git-resolve-conflict", "Resolve a merge conflict", "Resolve the current merge conflict in the file I name, preserving both intents; explain the resolution.", "Git"),
  b("git-changelog", "Draft a changelog entry", "Draft a changelog entry for the changes on this branch.", "Git"),
  // ── Docs ──
  b("docs-api", "Document a public API", "Document the public API of the module I name with usage examples.", "Docs"),
  b("docs-readme", "Update the README", "Update the README to reflect the change I describe; keep it concise and accurate.", "Docs"),
  b("docs-comments", "Add why-comments", "Add doc comments explaining WHY (not what) for the non-obvious code in the file I name.", "Docs"),
  b("docs-adr", "Write an ADR", "Write a short architecture decision record for the decision I describe (context, decision, consequences).", "Docs"),
  b("docs-onboarding", "Write onboarding notes", "Write onboarding notes for a new engineer covering how to run and test the area I name.", "Docs"),
  // ── Dependencies ──
  b("deps-bump-one", "Bump one dependency", "Bump the dependency I name to the latest compatible version and fix any breakage.", "Dependencies"),
  b("deps-audit", "Audit for vulnerabilities", "Audit dependencies for known vulnerabilities and propose safe upgrades.", "Dependencies"),
  b("deps-remove-unused", "Remove unused deps", "Find and remove unused dependencies; confirm the build and tests still pass.", "Dependencies"),
  b("deps-pin", "Pin loose versions", "Pin loosely-ranged dependency versions in the area I name for reproducible builds.", "Dependencies"),
  b("deps-migrate", "Migrate off a dep", "Migrate off the dependency I name to the suggested alternative; keep behavior identical.", "Dependencies"),
  // ── Performance ──
  b("perf-profile", "Profile a slow path", "Profile the slow path I describe, find the hotspot, and propose a fix with expected impact.", "Performance"),
  b("perf-nplus1", "Fix an N+1", "Find and fix the N+1 (query or loop) in the area I name.", "Performance"),
  b("perf-memoize", "Memoize expensive work", "Memoize or cache the expensive recomputation I name, guarding correctness.", "Performance"),
  b("perf-bundle", "Trim bundle size", "Identify and trim the largest avoidable contributors to bundle size.", "Performance"),
  b("perf-async", "Parallelize independent work", "Parallelize the independent sequential awaits in the function I name.", "Performance"),
  // ── Security ──
  b("sec-injection", "Check for injection", "Audit the input-handling in the area I name for injection (SQL/shell/path) and fix it.", "Security"),
  b("sec-authz", "Check authorization", "Audit the endpoint/handler I name for missing or broken authorization checks.", "Security"),
  b("sec-secrets", "Find leaked secrets", "Scan the area I name for hard-coded secrets or secrets logged/echoed, and remediate.", "Security"),
  b("sec-deps", "Triage a CVE", "Triage the CVE I paste against this codebase and propose the minimal safe remediation.", "Security"),
  b("sec-validation", "Harden input validation", "Harden input validation and error handling on the boundary I name.", "Security"),
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/maintain/prompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/maintain/prompts.ts src/lib/maintain/promptCatalog.ts src/lib/maintain/prompts.test.ts
git commit -m "feat(maintain): prompt model + built-in catalog + helpers"
```

---

### Task 2: Prompts store (global, persisted)

**Files:**
- Create: `src/stores/promptsStore.ts`
- Test: `src/stores/promptsStore.test.ts`

**Interfaces:**
- Consumes: `Prompt`, `PromptCategory` (Task 1); `BUILTIN_PROMPTS` (Task 1).
- Produces (zustand store `usePromptsStore`):
  - state: `userPrompts: Prompt[]`, `favoriteIds: string[]`
  - `allPrompts(): Prompt[]` (BUILTIN_PROMPTS ++ userPrompts)
  - `addPrompt(input: { title: string; body: string; category: PromptCategory }): void`
  - `updatePrompt(id: string, patch: Partial<Pick<Prompt, "title" | "body" | "category">>): void`
  - `deletePrompt(id: string): void` (user prompts only)
  - `toggleFavorite(id: string): void`

Persistence mirrors `settingsStore` (`localStorage` key). Test with an injected/no-op localStorage guard (jsdom provides `localStorage` under Vitest's default environment; if the project's vitest env is `node`, guard all `localStorage` access with `typeof localStorage !== "undefined"`, exactly as `demoMode.ts` does).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { usePromptsStore } from "./promptsStore";
import { BUILTIN_PROMPTS } from "../lib/maintain/promptCatalog";

beforeEach(() => {
  try { localStorage.removeItem("cadre-prompts"); } catch { /* node env */ }
  usePromptsStore.setState({ userPrompts: [], favoriteIds: [] });
});

describe("promptsStore", () => {
  it("allPrompts merges catalog + user prompts", () => {
    usePromptsStore.getState().addPrompt({ title: "Mine", body: "do it", category: "Refactor" });
    const all = usePromptsStore.getState().allPrompts();
    expect(all.length).toBe(BUILTIN_PROMPTS.length + 1);
    expect(all.some((p) => p.title === "Mine" && !p.builtin)).toBe(true);
  });
  it("deletePrompt removes only user prompts, not builtins", () => {
    const builtinId = BUILTIN_PROMPTS[0].id;
    usePromptsStore.getState().deletePrompt(builtinId);
    expect(usePromptsStore.getState().allPrompts().some((p) => p.id === builtinId)).toBe(true);
    usePromptsStore.getState().addPrompt({ title: "Mine", body: "x", category: "Git" });
    const mineId = usePromptsStore.getState().userPrompts[0].id;
    usePromptsStore.getState().deletePrompt(mineId);
    expect(usePromptsStore.getState().userPrompts.length).toBe(0);
  });
  it("toggleFavorite toggles membership", () => {
    usePromptsStore.getState().toggleFavorite("test-add-failing");
    expect(usePromptsStore.getState().favoriteIds).toContain("test-add-failing");
    usePromptsStore.getState().toggleFavorite("test-add-failing");
    expect(usePromptsStore.getState().favoriteIds).not.toContain("test-add-failing");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/promptsStore.test.ts`
Expected: FAIL — cannot find `./promptsStore`.

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * promptsStore — the Maintain cockpit's prompt library. Global (prompts are
 * reusable across every project), persisted to localStorage. The built-in
 * catalog is read-only; users add/edit/delete their own and favorite any prompt
 * (built-in or user) by id.
 */
import { create } from "zustand";
import { BUILTIN_PROMPTS } from "../lib/maintain/promptCatalog";
import type { Prompt, PromptCategory } from "../lib/maintain/prompts";

const KEY = "cadre-prompts";

interface Persisted { userPrompts: Prompt[]; favoriteIds: string[]; }

function load(): Persisted {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (raw) return JSON.parse(raw) as Persisted;
  } catch { /* corrupt or unavailable */ }
  return { userPrompts: [], favoriteIds: [] };
}

function persist(p: Persisted) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(p));
  } catch { /* quota / unavailable */ }
}

function genId(): string {
  try { if (typeof crypto !== "undefined" && crypto.randomUUID) return `u_${crypto.randomUUID()}`; } catch { /* fall through */ }
  return `u_${Math.random().toString(36).slice(2)}`;
}

interface PromptsStore {
  userPrompts: Prompt[];
  favoriteIds: string[];
  allPrompts: () => Prompt[];
  addPrompt: (input: { title: string; body: string; category: PromptCategory }) => void;
  updatePrompt: (id: string, patch: Partial<Pick<Prompt, "title" | "body" | "category">>) => void;
  deletePrompt: (id: string) => void;
  toggleFavorite: (id: string) => void;
}

export const usePromptsStore = create<PromptsStore>((set, get) => ({
  ...load(),
  allPrompts: () => [...BUILTIN_PROMPTS, ...get().userPrompts],
  addPrompt: ({ title, body, category }) => {
    const prompt: Prompt = { id: genId(), title, body, category, builtin: false };
    const userPrompts = [prompt, ...get().userPrompts];
    persist({ userPrompts, favoriteIds: get().favoriteIds });
    set({ userPrompts });
  },
  updatePrompt: (id, patch) => {
    const userPrompts = get().userPrompts.map((p) => (p.id === id ? { ...p, ...patch } : p));
    persist({ userPrompts, favoriteIds: get().favoriteIds });
    set({ userPrompts });
  },
  deletePrompt: (id) => {
    const userPrompts = get().userPrompts.filter((p) => p.id !== id);
    const favoriteIds = get().favoriteIds.filter((f) => f !== id);
    persist({ userPrompts, favoriteIds });
    set({ userPrompts, favoriteIds });
  },
  toggleFavorite: (id) => {
    const has = get().favoriteIds.includes(id);
    const favoriteIds = has ? get().favoriteIds.filter((f) => f !== id) : [...get().favoriteIds, id];
    persist({ userPrompts: get().userPrompts, favoriteIds });
    set({ favoriteIds });
  },
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/stores/promptsStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/promptsStore.ts src/stores/promptsStore.test.ts
git commit -m "feat(maintain): global persisted prompts store (catalog + user prompts + favorites)"
```

---

### Task 3: Staged tasks + batch model (reducers)

**Files:**
- Modify: `src/lib/maintain/tasks.ts`
- Test: `src/lib/maintain/tasks.test.ts` (extend)

**Interfaces:**
- Consumes: `taskBranch(id)` (existing in `tasks.ts`).
- Produces:
  - `type SubagentStatus = "running" | "done" | "failed"`
  - `interface StagedTask { id: string; prompt: string; createdAt: number }`
  - `interface SubagentRun { taskId: string; prompt: string; branch: string; status: SubagentStatus; log: string }`
  - `interface FleetBatch { id: string; createdAt: number; subagents: SubagentRun[] }`
  - `makeStagedTask(id: string, prompt: string, createdAt: number): StagedTask`
  - `removeStaged(list: StagedTask[], id: string): StagedTask[]`
  - `makeBatch(id: string, staged: StagedTask[], createdAt: number): FleetBatch`
  - `appendSubagentLog(batches: FleetBatch[], batchId: string, taskId: string, chunk: string): FleetBatch[]`
  - `setSubagentStatus(batches: FleetBatch[], batchId: string, taskId: string, status: SubagentStatus): FleetBatch[]`
- NOTE: the existing `MaintainTask`/`TaskStatus`/`makeTask`/`setTaskStatus` are removed (Task 5/8 stop importing them). Keep `taskBranch`.

- [ ] **Step 1: Write the failing test** (append to `tasks.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import {
  makeStagedTask, removeStaged, makeBatch, appendSubagentLog, setSubagentStatus,
} from "./tasks";

describe("staging + batch", () => {
  it("makeStagedTask holds the prompt", () => {
    expect(makeStagedTask("a1", "bump deps", 1000)).toEqual({ id: "a1", prompt: "bump deps", createdAt: 1000 });
  });
  it("removeStaged drops one immutably", () => {
    const list = [makeStagedTask("a", "x", 1), makeStagedTask("b", "y", 2)];
    const next = removeStaged(list, "a");
    expect(next.map((t) => t.id)).toEqual(["b"]);
    expect(next).not.toBe(list);
  });
  it("makeBatch turns staged tasks into running subagents on task/ branches", () => {
    const batch = makeBatch("btch", [makeStagedTask("a", "x", 1)], 5000);
    expect(batch).toEqual({
      id: "btch", createdAt: 5000,
      subagents: [{ taskId: "a", prompt: "x", branch: "task/a", status: "running", log: "" }],
    });
  });
  it("appendSubagentLog accumulates only the matching subagent", () => {
    const b = makeBatch("btch", [makeStagedTask("a", "x", 1), makeStagedTask("b", "y", 2)], 1);
    const next = appendSubagentLog([b], "btch", "a", "hello");
    expect(next[0].subagents.find((s) => s.taskId === "a")!.log).toBe("hello");
    expect(next[0].subagents.find((s) => s.taskId === "b")!.log).toBe("");
  });
  it("setSubagentStatus updates only the matching subagent", () => {
    const b = makeBatch("btch", [makeStagedTask("a", "x", 1)], 1);
    const next = setSubagentStatus([b], "btch", "a", "done");
    expect(next[0].subagents[0].status).toBe("done");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/maintain/tasks.test.ts`
Expected: FAIL — new exports not defined.

- [ ] **Step 3: Write minimal implementation** (replace the `MaintainTask` section of `tasks.ts`, keep `taskBranch`)

```ts
export type SubagentStatus = "running" | "done" | "failed";

export interface StagedTask { id: string; prompt: string; createdAt: number; }

export interface SubagentRun {
  taskId: string;
  prompt: string;
  branch: string;
  status: SubagentStatus;
  log: string;
}

export interface FleetBatch {
  id: string;
  createdAt: number;
  subagents: SubagentRun[];
}

export function taskBranch(id: string): string {
  return `task/${id}`;
}

export function makeStagedTask(id: string, prompt: string, createdAt: number): StagedTask {
  return { id, prompt, createdAt };
}

export function removeStaged(list: StagedTask[], id: string): StagedTask[] {
  return list.filter((t) => t.id !== id);
}

/** Freeze a staged list into a batch of running subagents (each on task/<id>). */
export function makeBatch(id: string, staged: StagedTask[], createdAt: number): FleetBatch {
  return {
    id,
    createdAt,
    subagents: staged.map((t) => ({
      taskId: t.id, prompt: t.prompt, branch: taskBranch(t.id), status: "running", log: "",
    })),
  };
}

function mapSubagent(
  batches: FleetBatch[], batchId: string, taskId: string, fn: (s: SubagentRun) => SubagentRun,
): FleetBatch[] {
  return batches.map((b) =>
    b.id !== batchId ? b : { ...b, subagents: b.subagents.map((s) => (s.taskId === taskId ? fn(s) : s)) });
}

export function appendSubagentLog(batches: FleetBatch[], batchId: string, taskId: string, chunk: string): FleetBatch[] {
  return mapSubagent(batches, batchId, taskId, (s) => ({ ...s, log: s.log + chunk }));
}

export function setSubagentStatus(batches: FleetBatch[], batchId: string, taskId: string, status: SubagentStatus): FleetBatch[] {
  return mapSubagent(batches, batchId, taskId, (s) => ({ ...s, status }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/maintain/tasks.test.ts`
Expected: PASS. (The old `MaintainTask` tests in this file must be deleted in this step since the type is gone.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/maintain/tasks.ts src/lib/maintain/tasks.test.ts
git commit -m "feat(maintain): staged-task + fleet-batch model and reducers"
```

---

### Task 4: Batch orchestration (`runSubagent`)

**Files:**
- Create: `src/lib/maintain/runBatch.ts`
- Test: `src/lib/maintain/runBatch.test.ts`
- Delete: `src/lib/maintain/dispatchOrchestration.ts` (+ any test) — superseded by `runBatch.ts`.

**Interfaces:**
- Consumes: `dispatchTask` (`src/lib/engine/dispatchTask.ts`, returns `{ ptyId, branch, worktree }`); `DispatchDeps` (`src/lib/engine/dispatch.ts`); `SubagentStatus` (Task 3).
- Produces:
  - `type RunSubagentDeps = DispatchDeps & { waitForExit: (ptyId: number) => Promise<{ exitCode: number | null }> }`
  - `runSubagent(deps: RunSubagentDeps, input: { repoPath: string; worktreeRoot: string; id: string; prompt: string; env?: Record<string,string>; model?: string; onStatus: (s: SubagentStatus) => void }): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { runSubagent } from "./runBatch";

const baseDeps = (over = {}) => ({
  runGit: vi.fn().mockResolvedValue(undefined),
  runGitQuery: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "" }),
  spawnAgent: vi.fn().mockResolvedValue(42),
  waitForExit: vi.fn().mockResolvedValue({ exitCode: 0 }),
  ...over,
});

describe("runSubagent", () => {
  it("spawns → running, then done on clean exit", async () => {
    const statuses: string[] = [];
    const deps = baseDeps();
    await runSubagent(deps as any, { repoPath: "/r", worktreeRoot: "/r", id: "a", prompt: "x", onStatus: (s) => statuses.push(s) });
    expect(statuses).toEqual(["running", "done"]);
    expect(deps.waitForExit).toHaveBeenCalledWith(42);
  });
  it("failed on non-zero exit", async () => {
    const statuses: string[] = [];
    const deps = baseDeps({ waitForExit: vi.fn().mockResolvedValue({ exitCode: 1 }) });
    await runSubagent(deps as any, { repoPath: "/r", worktreeRoot: "/r", id: "a", prompt: "x", onStatus: (s) => statuses.push(s) });
    expect(statuses).toEqual(["running", "failed"]);
  });
  it("failed when spawn throws (never reaches running)", async () => {
    const statuses: string[] = [];
    const deps = baseDeps({ spawnAgent: vi.fn().mockRejectedValue(new Error("no worktree")) });
    await runSubagent(deps as any, { repoPath: "/r", worktreeRoot: "/r", id: "a", prompt: "x", onStatus: (s) => statuses.push(s) });
    expect(statuses).toEqual(["failed"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/maintain/runBatch.test.ts`
Expected: FAIL — cannot find `./runBatch`.

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * runSubagent — orchestrate ONE maintenance subagent: create its isolated
 * task/<id> worktree + spawn the agent (dispatchTask), then drive status from
 * the PROCESS via waitForExit (running while alive → done on exit 0, failed on
 * non-zero or a spawn error). This is the fix for the old frozen "running"
 * badge: status is process-derived, never self-reported.
 *
 * The batch layer calls this once per staged task, concurrently, each streaming
 * to its own SubagentRun.log via the deps' onOutput sink (wired by the caller).
 */
import { dispatchTask } from "../engine/dispatchTask";
import type { DispatchDeps } from "../engine/dispatch";
import type { SubagentStatus } from "./tasks";

export type RunSubagentDeps = DispatchDeps & {
  waitForExit: (ptyId: number) => Promise<{ exitCode: number | null }>;
};

export async function runSubagent(
  deps: RunSubagentDeps,
  input: {
    repoPath: string;
    worktreeRoot: string;
    id: string;
    prompt: string;
    env?: Record<string, string>;
    model?: string;
    onStatus: (s: SubagentStatus) => void;
  },
): Promise<void> {
  let ptyId: number;
  try {
    const res = await dispatchTask(deps, input);
    ptyId = res.ptyId;
  } catch {
    input.onStatus("failed");
    return;
  }
  input.onStatus("running");
  try {
    const { exitCode } = await deps.waitForExit(ptyId);
    input.onStatus(exitCode === 0 ? "done" : "failed");
  } catch {
    input.onStatus("failed");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/maintain/runBatch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git rm src/lib/maintain/dispatchOrchestration.ts
git add src/lib/maintain/runBatch.ts src/lib/maintain/runBatch.test.ts
git commit -m "feat(maintain): batch orchestration — process-driven subagent status"
```

---

### Task 5: Staged-list persistence + `useCadre` wiring

**Files:**
- Create: `src/stores/maintainStaging.ts`
- Test: `src/stores/maintainStaging.test.ts`
- Modify: `src/lib/engine/projectSlices.ts` (CadreSlice: replace `tasks` with `stagedTasks` + `batches`; update `emptyCadreSlice`, `mirrorCadre`)
- Modify: `src/cadre/useCadre.ts` (remove `addMaintainTask`; add `stageTask`/`unstageTask`/`runStagedBatch`; mirror new fields; drop `MaintainTask`/`runMaintainTask` imports)

**Interfaces:**
- Consumes: `StagedTask`, `FleetBatch`, `makeStagedTask`, `removeStaged`, `makeBatch`, `appendSubagentLog`, `setSubagentStatus` (Task 3); `runSubagent`, `RunSubagentDeps` (Task 4); `tauriOrchestratorDeps`, `waitForExit` — note `waitForExit` is not currently exported from `tauriDeps.ts`; export it in this task.
- Produces:
  - `loadStaged(root: string): StagedTask[]`, `saveStaged(root: string, tasks: StagedTask[]): void` (`maintainStaging.ts`)
  - `useCadre` actions: `stageTask(prompt: string): void`, `unstageTask(id: string): void`, `runStagedBatch(): Promise<string | null>` (returns the new batch id, or null if nothing staged)
  - `useCadre` mirror state: `stagedTasks: StagedTask[]`, `batches: FleetBatch[]`

- [ ] **Step 1: Write the failing test** (persistence module only — the store actions are verified by running the app)

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { loadStaged, saveStaged } from "./maintainStaging";

beforeEach(() => { try { localStorage.removeItem("cadre-maintain-staged"); } catch { /* node */ } });

describe("maintainStaging", () => {
  it("round-trips staged tasks per root", () => {
    saveStaged("/a", [{ id: "1", prompt: "x", createdAt: 1 }]);
    saveStaged("/b", [{ id: "2", prompt: "y", createdAt: 2 }]);
    expect(loadStaged("/a").map((t) => t.id)).toEqual(["1"]);
    expect(loadStaged("/b").map((t) => t.id)).toEqual(["2"]);
  });
  it("returns [] for an unknown root", () => {
    expect(loadStaged("/nope")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/maintainStaging.test.ts`
Expected: FAIL — cannot find `./maintainStaging`.

- [ ] **Step 3: Write minimal implementation**

`src/stores/maintainStaging.ts` (mirrors `terminalSession.ts`):

```ts
/**
 * Per-project persistence of the Maintain view's STAGED task list (not the live
 * batches — those hold PTYs that die on quit). Keyed by project root under one
 * localStorage map, mirroring terminalSession's structure storage.
 */
import type { StagedTask } from "../lib/maintain/tasks";

const KEY = "cadre-maintain-staged";
type StagedMap = Record<string, StagedTask[]>;

function read(): StagedMap {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    return raw ? (JSON.parse(raw) as StagedMap) : {};
  } catch { return {}; }
}

export function loadStaged(root: string): StagedTask[] {
  return read()[root] ?? [];
}

export function saveStaged(root: string, tasks: StagedTask[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    const map = read();
    if (tasks.length) map[root] = tasks; else delete map[root];
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch { /* quota / unavailable */ }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/stores/maintainStaging.test.ts`
Expected: PASS.

- [ ] **Step 5: Export `waitForExit` from tauriDeps**

In `src/lib/engine/tauriDeps.ts`, change `function waitForExit(...)` to `export function waitForExit(...)` (it is already defined there, currently unexported).

- [ ] **Step 6: Update `projectSlices.ts`**

In `CadreSlice` (currently `tasks: MaintainTask[]`), replace with:

```ts
  /** Maintenance tasks staged (not yet run) for this project (Maintain mode). */
  stagedTasks: StagedTask[];
  /** Live fleet batches launched from the staged list (session-only). */
  batches: FleetBatch[];
```

Update the import at the top: `import type { StagedTask, FleetBatch } from "../maintain/tasks";` (remove `MaintainTask`). In `emptyCadreSlice()` replace `tasks: []` with `stagedTasks: [], batches: []`. In `mirrorCadre()` replace `tasks: s.tasks` with `stagedTasks: s.stagedTasks, batches: s.batches`.

- [ ] **Step 7: Update `useCadre.ts`**

Replace the mirror field declaration `tasks: MaintainTask[];` with `stagedTasks: StagedTask[];` and `batches: FleetBatch[];`; replace the initializer `tasks: []` with `stagedTasks: [], batches: []` (hydrate `stagedTasks` from `loadStaged(root)` inside `openProject`). Remove `addMaintainTask` and its `runMaintainTask` import. Add:

```ts
  stageTask: (prompt) => {
    const root = requireRoot();
    const text = prompt.trim();
    if (!text) return;
    const id = Math.random().toString(36).slice(2, 8);
    const next = [makeStagedTask(id, text, Date.now()), ...(get().projects[root]?.stagedTasks ?? [])];
    saveStaged(root, next);
    patchRoot(root, { stagedTasks: next });
  },
  unstageTask: (id) => {
    const root = requireRoot();
    const next = removeStaged(get().projects[root]?.stagedTasks ?? [], id);
    saveStaged(root, next);
    patchRoot(root, { stagedTasks: next });
  },
  runStagedBatch: async () => {
    const root = requireRoot();
    const staged = get().projects[root]?.stagedTasks ?? [];
    if (staged.length === 0) return null;
    const batchId = `b_${Math.random().toString(36).slice(2, 8)}`;
    const batch = makeBatch(batchId, staged, Date.now());
    // Freeze the staged list into the batch and clear staging.
    saveStaged(root, []);
    patchRoot(root, { stagedTasks: [], batches: [batch, ...(get().projects[root]?.batches ?? [])] });

    const repos = parseRepos(await readManifest(root));
    const repoPath = resolveRepoPath(root, findRepo(repos, DEFAULT_REPO_ID).path);
    const provider = getProvider(fleetProviderId());
    const { env, model } = await resolveFleetAuth(provider);

    await Promise.all(batch.subagents.map((sa) => {
      const onOutput = (chunk: string) =>
        patchRoot(root, { batches: appendSubagentLog(get().projects[root]?.batches ?? [], batchId, sa.taskId, chunk) });
      const deps: RunSubagentDeps = { ...tauriOrchestratorDeps(root, onOutput), waitForExit };
      return runSubagent(deps, {
        repoPath, worktreeRoot: root, id: sa.taskId, prompt: sa.prompt, env, model,
        onStatus: (s) => patchRoot(root, { batches: setSubagentStatus(get().projects[root]?.batches ?? [], batchId, sa.taskId, s) }),
      });
    }));
    return batchId;
  },
```

Add imports: `makeStagedTask, removeStaged, makeBatch, appendSubagentLog, setSubagentStatus` from `../lib/maintain/tasks`; `runSubagent, type RunSubagentDeps` from `../lib/maintain/runBatch`; `waitForExit` from `../lib/engine/tauriDeps`; `loadStaged, saveStaged` from `../stores/maintainStaging`. Update the `CadreActions` interface: remove `addMaintainTask`, add `stageTask`/`unstageTask`/`runStagedBatch` signatures (see Interfaces above).

- [ ] **Step 8: Verify typecheck + existing tests**

Run: `npx tsc --noEmit` (Expected: exit 0) and `npx vitest run src/lib/maintain src/stores/maintainStaging.test.ts src/stores/promptsStore.test.ts` (Expected: all pass).

- [ ] **Step 9: Commit**

```bash
git add src/stores/maintainStaging.ts src/stores/maintainStaging.test.ts src/lib/engine/projectSlices.ts src/lib/engine/tauriDeps.ts src/cadre/useCadre.ts
git commit -m "feat(maintain): staged-list persistence + stageTask/unstageTask/runStagedBatch"
```

---

### Task 6: SubagentCard + FleetTab UI

**Files:**
- Create: `src/cadre/maintain/SubagentCard.tsx`
- Create: `src/cadre/maintain/FleetTab.tsx`

**Interfaces:**
- Consumes: `SubagentRun`, `FleetBatch` (Task 3); `LiveTerminal` (`../agentShared`); `SubagentStatus`.
- Produces: `SubagentCard({ run, maximized, onToggleMax }: { run: SubagentRun; maximized: boolean; onToggleMax: () => void })`; `FleetTab({ batch }: { batch: FleetBatch })`.
- Verified by running the app (no React test harness).

- [ ] **Step 1: Implement `SubagentCard.tsx`** (mirror `PoolAgentNode` — header badge + pulse + label + `LiveTerminal`, plus a maximize button)

```tsx
/**
 * SubagentCard — one running maintenance subagent in a Fleet tab. Mirrors the
 * Fleet view's PoolAgentNode: a mono task/branch badge, a status pulse, the
 * status label, and a LiveTerminal tailing this subagent's output. A maximize
 * (⤢) control lets the user expand one card to watch its progress in detail.
 */
import { Maximize2, Minimize2 } from "lucide-react";
import { LiveTerminal } from "../agentShared";
import type { SubagentRun, SubagentStatus } from "../../lib/maintain/tasks";

function statusInfo(status: SubagentStatus): { label: string; color: string; dot: string; live: boolean } {
  switch (status) {
    case "running": return { label: "Running", color: "var(--c-accent)", dot: "cadre-dot cadre-dot-progress", live: true };
    case "done":    return { label: "Done",    color: "var(--c-success)", dot: "cadre-dot cadre-dot-success", live: false };
    case "failed":  return { label: "Failed",  color: "var(--c-warning)", dot: "cadre-dot cadre-dot-warning", live: false };
  }
}

export function SubagentCard({ run, maximized, onToggleMax }: { run: SubagentRun; maximized: boolean; onToggleMax: () => void }) {
  const info = statusInfo(run.status);
  const isRunning = run.status === "running";
  return (
    <div
      className={isRunning ? "cadre-generating" : undefined}
      style={{
        display: "flex", flexDirection: "column", minHeight: 0,
        background: "var(--c-surface-1)",
        border: `1.5px solid ${isRunning ? "color-mix(in srgb, var(--c-accent) 55%, var(--c-border))" : "var(--c-border-strong)"}`,
        borderRadius: "var(--c-radius)", overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "var(--c-space-2) var(--c-space-3)", background: "var(--c-surface-2)", borderBottom: "1px solid var(--c-border)" }}>
        <span className="cadre-label-mono" style={{ fontSize: "9px", fontWeight: 700, color: info.color, background: `color-mix(in srgb, ${info.color} 15%, transparent)`, border: `1px solid color-mix(in srgb, ${info.color} 35%, transparent)`, borderRadius: "var(--c-radius-full)", padding: "1px 7px" }}>
          {run.branch}
        </span>
        {info.live && <span className={info.dot} />}
        <span style={{ fontSize: "var(--c-fs-xs)", color: info.color, fontWeight: 500 }}>{info.label}</span>
        <button
          onClick={onToggleMax}
          title={maximized ? "Restore" : "Maximize"}
          aria-label={maximized ? "Restore subagent" : "Maximize subagent"}
          className="cadre-hover"
          style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: "var(--c-radius-sm)", background: "transparent", border: "1px solid var(--c-border)", color: "var(--c-text-secondary)", cursor: "pointer" }}
        >
          {maximized ? <Minimize2 size={12} strokeWidth={2} /> : <Maximize2 size={12} strokeWidth={2} />}
        </button>
      </div>
      <div style={{ padding: "var(--c-space-2) var(--c-space-3)", flex: 1, minHeight: 0, overflow: "hidden" }}>
        <div style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-secondary)", marginBottom: "var(--c-space-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={run.prompt}>
          {run.prompt}
        </div>
        <LiveTerminal log={run.log} empty={isRunning ? "Waiting for the agent…" : "No output"} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement `FleetTab.tsx`** (grid of cards; one maximized fills the tab)

```tsx
/**
 * FleetTab — the live fleet for one batch of maintenance subagents. A responsive
 * grid of SubagentCards; maximizing a card hides the rest so the user can watch
 * that one agent's progress full-tab. Maximize state is local to this tab.
 */
import { useState } from "react";
import { SubagentCard } from "./SubagentCard";
import type { FleetBatch } from "../../lib/maintain/tasks";

export function FleetTab({ batch }: { batch: FleetBatch }) {
  const [maxId, setMaxId] = useState<string | null>(null);
  const runs = maxId ? batch.subagents.filter((s) => s.taskId === maxId) : batch.subagents;
  const toggle = (id: string) => setMaxId((cur) => (cur === id ? null : id));

  return (
    <div style={{ height: "100%", minHeight: 0, overflow: "auto", padding: "var(--c-space-4)" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: maxId ? "1fr" : "repeat(auto-fill, minmax(340px, 1fr))",
          gap: "var(--c-space-4)",
          minHeight: 0,
          height: maxId ? "100%" : undefined,
        }}
      >
        {runs.map((run) => (
          <div key={run.taskId} style={{ minHeight: maxId ? 0 : 220, height: maxId ? "100%" : undefined, display: "flex" }}>
            <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex" }}>
              <SubagentCard run={run} maximized={maxId === run.taskId} onToggleMax={() => toggle(run.taskId)} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/cadre/maintain/SubagentCard.tsx src/cadre/maintain/FleetTab.tsx
git commit -m "feat(maintain): FleetTab + SubagentCard (live fleet with maximize)"
```

---

### Task 7: Left rail — Prompts library + Thoughts composer + Staged list

**Files:**
- Create: `src/cadre/maintain/PromptsRail.tsx`
- Rewrite: `src/cadre/maintain/TaskQueue.tsx` → replace its contents with the intake rail described here, OR create `src/cadre/maintain/IntakeRail.tsx` and delete `TaskQueue.tsx`. Use `IntakeRail.tsx` (clearer name).
- Delete: `src/cadre/maintain/TaskQueue.tsx`

**Interfaces:**
- Consumes: `usePromptsStore` (Task 2); `searchPrompts`, `groupByCategory`, `PROMPT_CATEGORIES` (Task 1); `useCadre` `stagedTasks`/`stageTask`/`unstageTask`/`runStagedBatch` (Task 5).
- Produces: `IntakeRail({ onBatchLaunched }: { onBatchLaunched: (batchId: string) => void })` (the parent opens/focuses the new Fleet tab); `PromptsRail({ onPick }: { onPick: (body: string) => void })`.
- Verified by running the app.

- [ ] **Step 1: Implement `PromptsRail.tsx`** — search box + grouped, collapsible categories; each row inserts its body via `onPick`; a star toggles favorite; a "+ New prompt" inline editor calls `addPrompt`; user prompts show edit/delete.

```tsx
/**
 * PromptsRail — the prompt library. A search box over grouped categories
 * (Favorites first); clicking a prompt inserts its body into the Thoughts
 * composer (onPick). Users can favorite any prompt and add/edit/delete their own.
 */
import { useState } from "react";
import { Search, Star, Plus, Trash2 } from "lucide-react";
import { usePromptsStore } from "../../stores/promptsStore";
import { searchPrompts, groupByCategory, PROMPT_CATEGORIES, type PromptCategory } from "../../lib/maintain/prompts";

export function PromptsRail({ onPick }: { onPick: (body: string) => void }) {
  const userPrompts = usePromptsStore((s) => s.userPrompts);
  const favoriteIds = usePromptsStore((s) => s.favoriteIds);
  const allPrompts = usePromptsStore((s) => s.allPrompts);
  const toggleFavorite = usePromptsStore((s) => s.toggleFavorite);
  const addPrompt = usePromptsStore((s) => s.addPrompt);
  const deletePrompt = usePromptsStore((s) => s.deletePrompt);

  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ title: string; body: string; category: PromptCategory }>({ title: "", body: "", category: "Testing" });

  // allPrompts() reads BUILTIN + userPrompts; subscribe to userPrompts so it re-renders on add/delete.
  void userPrompts;
  const groups = groupByCategory(searchPrompts(allPrompts(), query), favoriteIds);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "var(--c-space-2) var(--c-space-3)", borderBottom: "1px solid var(--c-border)" }}>
        <Search size={13} style={{ color: "var(--c-text-muted)" }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search prompts…"
          style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: "var(--c-text)", fontSize: "var(--c-fs-sm)" }}
        />
        <button onClick={() => setAdding((a) => !a)} title="New prompt" aria-label="New prompt" className="cadre-hover" style={{ display: "inline-flex", width: 22, height: 22, alignItems: "center", justifyContent: "center", background: "transparent", border: "1px solid var(--c-border)", borderRadius: "var(--c-radius-sm)", color: "var(--c-text-secondary)", cursor: "pointer" }}>
          <Plus size={13} strokeWidth={2.5} />
        </button>
      </div>

      {adding && (
        <div style={{ padding: "var(--c-space-2) var(--c-space-3)", borderBottom: "1px solid var(--c-border)", display: "flex", flexDirection: "column", gap: "var(--c-space-2)" }}>
          <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Title" style={{ border: "1px solid var(--c-border)", borderRadius: "var(--c-radius-sm)", background: "var(--c-surface-2)", color: "var(--c-text)", padding: "4px 8px", fontSize: "var(--c-fs-sm)" }} />
          <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} placeholder="Prompt body" rows={3} style={{ border: "1px solid var(--c-border)", borderRadius: "var(--c-radius-sm)", background: "var(--c-surface-2)", color: "var(--c-text)", padding: "4px 8px", fontSize: "var(--c-fs-sm)", resize: "none" }} />
          <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as PromptCategory })} style={{ background: "var(--c-surface-2)", color: "var(--c-text)", border: "1px solid var(--c-border)", borderRadius: "var(--c-radius-sm)", padding: "4px 8px", fontSize: "var(--c-fs-sm)" }}>
            {PROMPT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            className="cadre-btn-primary"
            disabled={!draft.title.trim() || !draft.body.trim()}
            onClick={() => { addPrompt({ title: draft.title.trim(), body: draft.body.trim(), category: draft.category }); setDraft({ title: "", body: "", category: "Testing" }); setAdding(false); }}
            style={{ fontSize: "var(--c-fs-sm)", padding: "5px 12px", borderRadius: "var(--c-radius)", border: "none", cursor: "pointer" }}
          >
            Save prompt
          </button>
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto", padding: "var(--c-space-2) var(--c-space-3)" }}>
        {groups.map((g) => (
          <div key={g.category} style={{ marginBottom: "var(--c-space-3)" }}>
            <div className="cadre-label-mono" style={{ fontSize: "9px", fontWeight: 700, color: "var(--c-text-muted)", letterSpacing: "0.06em", marginBottom: 4 }}>{g.category}</div>
            {g.prompts.map((p) => (
              <div key={`${g.category}:${p.id}`} className="cadre-hover" style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 6px", borderRadius: "var(--c-radius-sm)", cursor: "pointer" }} onClick={() => onPick(p.body)} title={p.body}>
                <button onClick={(e) => { e.stopPropagation(); toggleFavorite(p.id); }} title="Favorite" aria-label="Toggle favorite" style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, display: "inline-flex", color: favoriteIds.includes(p.id) ? "var(--c-warning)" : "var(--c-text-faint)" }}>
                  <Star size={12} strokeWidth={2} fill={favoriteIds.includes(p.id) ? "currentColor" : "none"} />
                </button>
                <span style={{ flex: 1, minWidth: 0, fontSize: "var(--c-fs-sm)", color: "var(--c-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</span>
                {!p.builtin && (
                  <button onClick={(e) => { e.stopPropagation(); deletePrompt(p.id); }} title="Delete prompt" aria-label="Delete prompt" style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, display: "inline-flex", color: "var(--c-text-faint)" }}>
                    <Trash2 size={12} strokeWidth={2} />
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement `IntakeRail.tsx`** — composes `PromptsRail` (top) + a Thoughts composer + the staged list with **Run all**.

```tsx
/**
 * IntakeRail — the Maintain cockpit's left rail. PromptsRail (library) feeds a
 * Thoughts composer (staging text); "Add to list" stages a task; "Run all"
 * freezes the staged list into a fleet batch and hands the new batch id up so
 * the parent opens its Fleet tab.
 */
import { useState } from "react";
import { ListTodo, Plus, Play, X } from "lucide-react";
import { PromptsRail } from "./PromptsRail";
import { useCadre } from "../useCadre";

export function IntakeRail({ onBatchLaunched }: { onBatchLaunched: (batchId: string) => void }) {
  const staged = useCadre((s) => s.stagedTasks);
  const stageTask = useCadre((s) => s.stageTask);
  const unstageTask = useCadre((s) => s.unstageTask);
  const runStagedBatch = useCadre((s) => s.runStagedBatch);

  const [thought, setThought] = useState("");
  const [running, setRunning] = useState(false);

  const add = () => { const t = thought.trim(); if (!t) return; stageTask(t); setThought(""); };
  const runAll = async () => {
    setRunning(true);
    try { const id = await runStagedBatch(); if (id) onBatchLaunched(id); }
    finally { setRunning(false); }
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PromptsRail onPick={(body) => setThought((cur) => (cur ? `${cur}\n${body}` : body))} />

      {/* Thoughts composer */}
      <div style={{ borderTop: "1px solid var(--c-border)", padding: "var(--c-space-2) var(--c-space-3)", display: "flex", flexDirection: "column", gap: "var(--c-space-2)" }}>
        <textarea value={thought} onChange={(e) => setThought(e.target.value)} placeholder="Compose a task — pull a prompt above or type your own…" rows={3} style={{ width: "100%", resize: "none", border: "1px solid var(--c-border-strong)", borderRadius: "var(--c-radius)", background: "var(--c-surface-2)", color: "var(--c-text)", fontFamily: "inherit", fontSize: "var(--c-fs-base)", padding: "var(--c-space-2)", outline: "none" }} />
        <button onClick={add} disabled={!thought.trim()} className="cadre-hover" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: "var(--c-fs-sm)", fontWeight: 550, padding: "5px 12px", borderRadius: "var(--c-radius)", border: "1px solid var(--c-border)", background: "var(--c-surface-2)", color: thought.trim() ? "var(--c-text)" : "var(--c-text-muted)", cursor: thought.trim() ? "pointer" : "default" }}>
          <Plus size={13} strokeWidth={2.5} /> Add to list
        </button>
      </div>

      {/* Staged list + Run all */}
      <div style={{ borderTop: "1px solid var(--c-border)", display: "flex", flexDirection: "column", minHeight: 0, flexShrink: 0, maxHeight: "40%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "var(--c-space-2) var(--c-space-3)" }}>
          <ListTodo size={13} style={{ color: "var(--c-text-muted)" }} />
          <span style={{ fontSize: "var(--c-fs-sm)", fontWeight: 600, color: "var(--c-text)" }}>Staged</span>
          <span style={{ fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>{staged.length}</span>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "0 var(--c-space-3)", display: "flex", flexDirection: "column", gap: 4 }}>
          {staged.map((t) => (
            <div key={t.id} style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "var(--c-space-2)", background: "var(--c-surface-2)", border: "1px solid var(--c-border)", borderRadius: "var(--c-radius-sm)" }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: "var(--c-fs-sm)", color: "var(--c-text)", wordBreak: "break-word" }}>{t.prompt}</span>
              <button onClick={() => unstageTask(t.id)} title="Remove" aria-label="Remove staged task" style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--c-text-faint)", padding: 0, display: "inline-flex" }}>
                <X size={12} strokeWidth={2.5} />
              </button>
            </div>
          ))}
        </div>
        <div style={{ padding: "var(--c-space-2) var(--c-space-3)" }}>
          <button onClick={() => void runAll()} disabled={staged.length === 0 || running} className={staged.length > 0 && !running ? "cadre-btn-primary" : undefined} style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: "var(--c-fs-sm)", fontWeight: 600, padding: "7px 12px", borderRadius: "var(--c-radius)", border: "none", background: staged.length > 0 && !running ? undefined : "var(--c-surface-3)", color: staged.length > 0 && !running ? undefined : "var(--c-text-muted)", cursor: staged.length > 0 && !running ? "pointer" : "default" }}>
            <Play size={13} strokeWidth={2.5} /> Run all{staged.length > 0 ? ` (${staged.length})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0. (`TaskQueue.tsx` is still imported by `MaintainView.tsx` until Task 8 — that's fine; delete `TaskQueue.tsx` in Task 8 when the import is removed. If `tsc` complains about an unused file, leave the delete to Task 8.)

- [ ] **Step 4: Commit**

```bash
git add src/cadre/maintain/PromptsRail.tsx src/cadre/maintain/IntakeRail.tsx
git commit -m "feat(maintain): intake rail — prompts library + thoughts composer + staged list"
```

---

### Task 8: MaintainView rewrite — tabbed main area (Terminal + Fleet tabs)

**Files:**
- Create: `src/cadre/maintain/MaintainMainTabs.tsx`
- Rewrite: `src/cadre/MaintainView.tsx`
- Delete: `src/cadre/maintain/TaskQueue.tsx`

**Interfaces:**
- Consumes: `TerminalTabs` (`../TerminalTabs`); `FleetTab` (Task 6); `IntakeRail` (Task 7); `useCadre` `batches` (Task 5); `useBmadStore` `projectRoot`.
- Produces: `MaintainMainTabs({ projectRoot }: { projectRoot: string })`.
- Verified by running the app.

- [ ] **Step 1: Implement `MaintainMainTabs.tsx`** — a tab strip with a persistent Terminal tab + one Fleet tab per batch; `runStagedBatch` (via IntakeRail) focuses the newest.

```tsx
/**
 * MaintainMainTabs — the cockpit's main area. A persistent Terminal tab (the
 * project Claude session) plus one Fleet tab per launched batch. The IntakeRail's
 * "Run all" opens and focuses the new Fleet tab. All tabs stay mounted (Terminal
 * PTYs must survive tab switches); only the active one is shown.
 */
import { useEffect, useState } from "react";
import { Terminal as TerminalIcon, Network, X } from "lucide-react";
import { TerminalTabs } from "../TerminalTabs";
import { FleetTab } from "./FleetTab";
import { IntakeRail } from "./IntakeRail";
import { useCadre } from "../useCadre";

export function MaintainMainTabs({ projectRoot }: { projectRoot: string }) {
  const batches = useCadre((s) => s.batches);
  const [active, setActive] = useState<string>("terminal");

  // If the active Fleet tab's batch disappears (e.g. project switch), fall back to Terminal.
  useEffect(() => {
    if (active !== "terminal" && !batches.some((b) => b.id === active)) setActive("terminal");
  }, [active, batches]);

  const fmt = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  const hidden = (on: boolean) => ({ position: "absolute" as const, inset: 0, display: on ? "block" : "none" });

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      {/* Left rail */}
      <div style={{ width: 320, flexShrink: 0, minHeight: 0, borderRight: "1px solid var(--c-border)", background: "var(--c-surface-1)" }}>
        <IntakeRail onBatchLaunched={(id) => setActive(id)} />
      </div>

      {/* Main tabbed area */}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 2, padding: "3px 6px", borderBottom: "1px solid var(--c-border)", background: "var(--c-surface-1)", flexShrink: 0, overflowX: "auto" }}>
          <TabButton icon={<TerminalIcon size={12} strokeWidth={2} />} label="Terminal" on={active === "terminal"} onClick={() => setActive("terminal")} />
          {batches.map((b) => (
            <TabButton key={b.id} icon={<Network size={12} strokeWidth={2} />} label={`Fleet · ${fmt(b.createdAt)}`} on={active === b.id} onClick={() => setActive(b.id)} />
          ))}
        </div>
        <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
          <div style={hidden(active === "terminal")}>
            <TerminalTabs key={projectRoot} cwd={projectRoot} startupCommand="claude" surfaceId={`maintain:${projectRoot}`} />
          </div>
          {batches.map((b) => (
            <div key={b.id} style={hidden(active === b.id)}>
              <FleetTab batch={b} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TabButton({ icon, label, on, onClick }: { icon: React.ReactNode; label: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-pressed={on} className="cadre-hover" style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 26, fontSize: "var(--c-fs-xs)", fontWeight: 550, padding: "0 10px", borderRadius: "var(--c-radius-sm)", background: on ? "var(--c-surface-3)" : "transparent", border: "none", color: on ? "var(--c-text)" : "var(--c-text-muted)", cursor: "pointer", flexShrink: 0 }}>
      {icon}{label}
    </button>
  );
}
```

Note: the `X`/close-tab affordance import is included for a follow-up; closing Fleet tabs is out of scope this slice (batches clear on project close). Remove the unused `X` import to keep `tsc` clean, or wire a close button that drops the batch from `useCadre.batches` — implementer's choice; keep `tsc` green.

- [ ] **Step 2: Rewrite `MaintainView.tsx`** — keep the header, swap the two-pane body for `MaintainMainTabs`.

```tsx
/**
 * MaintainView — the Maintenance/Support cockpit for an existing app. Stage a
 * list of tasks in the left rail (prompts + composer), then Run all to launch
 * them as a live fleet of isolated-worktree subagents in a new Fleet tab.
 */
import { Wrench } from "lucide-react";
import { useBmadStore } from "../stores/bmadStore";
import { MaintainMainTabs } from "./maintain/MaintainMainTabs";

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function MaintainView() {
  const projectRoot = useBmadStore((s) => s.projectRoot);
  if (!projectRoot) return null;
  const repo = basename(projectRoot);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0, background: "var(--c-bg)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--c-space-2)", padding: "var(--c-space-2) var(--c-space-4)", borderBottom: "1px solid var(--c-border)", background: "var(--c-surface-1)", flexShrink: 0 }}>
        <Wrench size={14} strokeWidth={2} style={{ color: "var(--c-accent)" }} />
        <span style={{ fontSize: "var(--c-fs-sm)", fontWeight: 650, color: "var(--c-text)", letterSpacing: "0.01em" }}>Maintain</span>
        <span style={{ fontSize: "var(--c-fs-sm)", color: "var(--c-text-faint)" }}>·</span>
        <span className="cadre-label-mono" style={{ fontSize: "var(--c-fs-xs)", fontWeight: 600, color: "var(--c-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={projectRoot}>{repo}</span>
        <span style={{ marginLeft: "auto", fontSize: "var(--c-fs-xs)", color: "var(--c-text-faint)" }}>Stage tasks on the left · Run all to launch a fleet</span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <MaintainMainTabs projectRoot={projectRoot} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Delete the dead intake and verify build**

```bash
git rm src/cadre/maintain/TaskQueue.tsx
```

Run: `npx tsc --noEmit` (Expected: exit 0) and `npm run build` (Expected: success). Grep to confirm nothing still imports the removed symbols: `grep -rn "TaskQueue\|addMaintainTask\|MaintainTask\|runMaintainTask\|dispatchOrchestration" src/` should return nothing (outside git history).

- [ ] **Step 4: Run the app and verify end-to-end**

```bash
npm run tauri dev
```

In the running app, open the **HFT** project (non-greenfield → Maintain mode) and verify:
1. Left rail shows the Prompts library (categories + search + favorites + New prompt) and an empty Staged list.
2. Click a prompt → its body lands in the Thoughts composer. Edit it, "Add to list" → it appears under Staged. Stage 2–3 tasks.
3. "Run all" → a new **Fleet · HH:MM** tab opens and focuses, showing one card per task with a live output tail and a **Running** pulse.
4. Each card's **maximize (⤢)** expands it to fill the tab; restore returns to the grid.
5. Cards move **Running → Done/Failed** as each agent exits (no longer frozen). Cross-check: `git -C ~/Project/HFT branch --list 'task/*'` and `git -C <worktree> log` show the agent's commits, or a failed card shows the error in its log.
6. Switch to the **Terminal** tab and back — the Claude PTY survives.

- [ ] **Step 5: Commit**

```bash
git add src/cadre/maintain/MaintainMainTabs.tsx src/cadre/MaintainView.tsx
git commit -m "feat(maintain): tabbed cockpit — Terminal + per-run Fleet tabs"
```

---

## Self-Review

- **Spec coverage:** Prompts model+catalog (T1), prompts store/CRUD/favorites (T2), staged+batch model (T3), process-driven status via waitForExit (T4), staged persistence + `runStagedBatch` batch dispatch (T5), fleet cards + maximize (T6), prompts+composer+staged intake (T7), tabbed main area with new-tab-per-run + MaintainView rewrite + removal of old TaskQueue (T8). Non-goals (verify/triage/PR-handoff, batch persistence, cross-project prompt sync) are excluded by construction.
- **Isolation:** every subagent uses `dispatchTask` (task/<id> worktree) — T4/T5. No `runApprovedStory`/`dispatchStory`.
- **Type consistency:** `StagedTask`/`SubagentRun`/`FleetBatch`/`SubagentStatus` defined in T3 are consumed unchanged in T4–T8; `runStagedBatch(): Promise<string | null>` returns the batch id that T7/T8 use to focus the tab; `RunSubagentDeps` (T4) is constructed in T5 from `tauriOrchestratorDeps` + exported `waitForExit`.
- **Removals accounted for:** `MaintainTask`/`makeTask`/`setTaskStatus`/`addMaintainTask`/`runMaintainTask`/`dispatchOrchestration.ts`/`TaskQueue.tsx` all removed across T3/T4/T5/T8; T8 greps to confirm no dangling references.
