# Maintenance / Support View — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opening an existing (non-greenfield) app switches Cadre to a Maintenance/Support view — a three-panel workspace (Task queue · Fleet · Terminal) where typing a prompt dispatches a real agent on a `task/<id>` branch.

**Architecture:** A per-project `mode` (`"build" | "maintain"`) is resolved when a project opens, from whether it has greenfield plan artifacts. When `maintain`, `CadreApp` renders a new `MaintainView` instead of the PlanningStudio. Maintenance dispatch reuses the **low-level engine** (`src/lib/engine/dispatch.ts`: worktree + agent spawn via injectable `DispatchDeps`) — NOT `useCadre.dispatchStory`/`runApprovedStory`, which require a sharded story, an approved plan, and a frozen verify command that a maintenance task does not have.

**Tech Stack:** TypeScript, React, Zustand (`useCadre`, `useBmadStore`), Vitest, Tauri (`invoke`), existing components `AgentOrgChart` and `TerminalPanel`.

## Global Constraints

- Reuse existing primitives; do NOT duplicate `AgentOrgChart` or `TerminalPanel` — embed them (`AgentOrgChart()` takes no props; `TerminalPanel({ cwd }: { cwd: string })`).
- Maintenance dispatch MUST NOT call `runApprovedStory` or `useCadre.dispatchStory` — those enforce the PLAN gate and require `docs/stories/*.md`.
- Pure logic (mode detection, task reducers, dispatch orchestration) is unit-tested with injected deps, mirroring `src/lib/engine/dispatch.test.ts`. UI wiring is verified by running the app.
- Style: match the codebase — `--c-*` CSS tokens, lucide-react icons, injected-deps testable seams, doc comments explaining *why*.
- **Out of slice 1 (later slices):** error/log task intake, the triage queue, the per-task verification wedge (repro test + frozen verify), and PR handoff. Slice 1 dispatches and streams logs only; a task's terminal state is `running` (no auto-verify).

---

### Task 1: Project mode detection

**Files:**
- Create: `src/lib/engine/projectMode.ts`
- Test: `src/lib/engine/projectMode.test.ts`

**Interfaces:**
- Produces: `type ProjectMode = "build" | "maintain"` and `detectProjectMode(input: { hasPrd: boolean; hasStories: boolean }): ProjectMode`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { detectProjectMode } from "./projectMode";

describe("detectProjectMode", () => {
  it("is 'build' when a PRD exists (greenfield in progress)", () => {
    expect(detectProjectMode({ hasPrd: true, hasStories: false })).toBe("build");
  });
  it("is 'build' when stories have been sharded", () => {
    expect(detectProjectMode({ hasPrd: false, hasStories: true })).toBe("build");
  });
  it("is 'maintain' for an existing app with no greenfield artifacts", () => {
    expect(detectProjectMode({ hasPrd: false, hasStories: false })).toBe("maintain");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/engine/projectMode.test.ts`
Expected: FAIL — "detectProjectMode is not a function".

- [ ] **Step 3: Write minimal implementation**

```ts
export type ProjectMode = "build" | "maintain";

/**
 * Resolve a project's working mode. A repo that already carries greenfield plan
 * artifacts (a PRD, or sharded stories) is a Build project being resumed; a repo
 * with neither is an existing app opened for Maintenance/Support work.
 */
export function detectProjectMode(input: { hasPrd: boolean; hasStories: boolean }): ProjectMode {
  return input.hasPrd || input.hasStories ? "build" : "maintain";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/engine/projectMode.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/projectMode.ts src/lib/engine/projectMode.test.ts
git commit -m "feat(maintain): project mode detection (build vs maintain)"
```

---

### Task 2: Maintenance task model + reducers

**Files:**
- Create: `src/lib/maintain/tasks.ts`
- Test: `src/lib/maintain/tasks.test.ts`

**Interfaces:**
- Produces:
  - `type TaskStatus = "queued" | "running" | "verified" | "failed"`
  - `interface MaintainTask { id: string; prompt: string; status: TaskStatus; branch: string; createdAt: number }`
  - `taskBranch(id: string): string` → `"task/<id>"`
  - `makeTask(id: string, prompt: string, createdAt: number): MaintainTask` (status `"queued"`)
  - `setTaskStatus(tasks: MaintainTask[], id: string, status: TaskStatus): MaintainTask[]` (pure, returns a new array)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { makeTask, taskBranch, setTaskStatus } from "./tasks";

describe("maintain tasks", () => {
  it("taskBranch namespaces under task/", () => {
    expect(taskBranch("a1b2")).toBe("task/a1b2");
  });
  it("makeTask starts queued with a task/ branch", () => {
    const t = makeTask("a1b2", "bump deps", 1000);
    expect(t).toEqual({ id: "a1b2", prompt: "bump deps", status: "queued", branch: "task/a1b2", createdAt: 1000 });
  });
  it("setTaskStatus updates only the matching task, immutably", () => {
    const a = makeTask("a", "x", 1);
    const b = makeTask("b", "y", 2);
    const next = setTaskStatus([a, b], "a", "running");
    expect(next.find((t) => t.id === "a")!.status).toBe("running");
    expect(next.find((t) => t.id === "b")!.status).toBe("queued");
    expect(next).not.toBe([a, b]); // new array
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/maintain/tasks.test.ts`
Expected: FAIL — module not found / functions undefined.

- [ ] **Step 3: Write minimal implementation**

```ts
export type TaskStatus = "queued" | "running" | "verified" | "failed";

export interface MaintainTask {
  id: string;
  prompt: string;
  status: TaskStatus;
  branch: string;
  createdAt: number;
}

export function taskBranch(id: string): string {
  return `task/${id}`;
}

export function makeTask(id: string, prompt: string, createdAt: number): MaintainTask {
  return { id, prompt, status: "queued", branch: taskBranch(id), createdAt };
}

export function setTaskStatus(tasks: MaintainTask[], id: string, status: TaskStatus): MaintainTask[] {
  return tasks.map((t) => (t.id === id ? { ...t, status } : t));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/maintain/tasks.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/maintain/tasks.ts src/lib/maintain/tasks.test.ts
git commit -m "feat(maintain): task model + pure reducers"
```

---

### Task 3: Maintenance dispatch (engine)

**Files:**
- Create: `src/lib/engine/dispatchTask.ts`
- Test: `src/lib/engine/dispatchTask.test.ts`

**Interfaces:**
- Consumes: `DispatchDeps` from `./dispatch` (`runGit`, `runGitQuery`, `spawnAgent`); `taskBranch` from `../maintain/tasks`.
- Produces: `dispatchTask(deps: DispatchDeps, input: DispatchTaskInput): Promise<DispatchTaskResult>` where
  - `interface DispatchTaskInput { repoPath: string; worktreeRoot: string; id: string; prompt: string; env?: Record<string, string>; model?: string }`
  - `interface DispatchTaskResult { ptyId: number; branch: string; worktree: string }`
- `MAINTAIN_SYSTEM_PROMPT: string` (a persona string; keep short, e.g. "You are a maintenance/support engineer. Make the smallest correct change that resolves the request. Do not open PRs or push; leave your work committed on this branch.").

**Note:** This mirrors `dispatch.ts:dispatchStory` (idempotent worktree reset → `worktree add -b` → `spawnAgent`) but keyed by task id and with no story-file/plan coupling. The worktree path is `${worktreeRoot}/.cadre/worktrees/task-<id>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { dispatchTask } from "./dispatchTask";

function deps() {
  return {
    runGit: vi.fn().mockResolvedValue(undefined),
    runGitQuery: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "" }),
    spawnAgent: vi.fn().mockResolvedValue(42),
  };
}

describe("dispatchTask", () => {
  it("creates a task/<id> worktree and spawns the agent in it", async () => {
    const d = deps();
    const res = await dispatchTask(d, {
      repoPath: "/repo", worktreeRoot: "/repo", id: "a1", prompt: "bump deps",
    });
    expect(res.branch).toBe("task/a1");
    expect(res.worktree).toBe("/repo/.cadre/worktrees/task-a1");
    // worktree created on the task branch
    expect(d.runGit).toHaveBeenCalledWith(
      ["worktree", "add", "-b", "task/a1", "/repo/.cadre/worktrees/task-a1", "HEAD"], "/repo",
    );
    // agent spawned in that worktree, prompt passed after the flags
    const spawn = d.spawnAgent.mock.calls[0][0];
    expect(spawn.cwd).toBe("/repo/.cadre/worktrees/task-a1");
    expect(spawn.command).toBe("claude");
    expect(spawn.args[spawn.args.length - 2]).toBe("-p");
    expect(spawn.args[spawn.args.length - 1]).toContain("bump deps");
    expect(res.ptyId).toBe(42);
  });

  it("passes per-agent env and model through to spawn", async () => {
    const d = deps();
    await dispatchTask(d, {
      repoPath: "/repo", worktreeRoot: "/repo", id: "a2", prompt: "x",
      env: { ANTHROPIC_BASE_URL: "u" }, model: "claude-sonnet-4-6",
    });
    const spawn = d.spawnAgent.mock.calls[0][0];
    expect(spawn.env).toEqual({ ANTHROPIC_BASE_URL: "u" });
    expect(spawn.args).toContain("--model");
    expect(spawn.args).toContain("claude-sonnet-4-6");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/engine/dispatchTask.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { DispatchDeps } from "./dispatch";
import { taskBranch } from "../maintain/tasks";

export const MAINTAIN_SYSTEM_PROMPT =
  "You are a maintenance/support engineer working in an existing codebase. Make the " +
  "smallest correct change that resolves the request, matching the surrounding code. " +
  "Do NOT open pull requests, push, close/merge PRs, or delete branches — leave your " +
  "work committed on this branch and stop.";

export interface DispatchTaskInput {
  repoPath: string;
  worktreeRoot: string;
  id: string;
  prompt: string;
  env?: Record<string, string>;
  model?: string;
}

export interface DispatchTaskResult {
  ptyId: number;
  branch: string;
  worktree: string;
}

export async function dispatchTask(deps: DispatchDeps, input: DispatchTaskInput): Promise<DispatchTaskResult> {
  const branch = taskBranch(input.id);
  const worktree = `${input.worktreeRoot}/.cadre/worktrees/task-${input.id}`;

  // Idempotent: clear any stale worktree/branch from an interrupted prior run.
  const tryGit = async (args: string[]) => {
    try { await deps.runGit(args, input.repoPath); } catch { /* nothing to clean */ }
  };
  await tryGit(["worktree", "remove", "--force", worktree]);
  await tryGit(["worktree", "prune"]);
  await tryGit(["branch", "-D", branch]);

  await deps.runGit(["worktree", "add", "-b", branch, worktree, "HEAD"], input.repoPath);

  const fullPrompt = `${MAINTAIN_SYSTEM_PROMPT}\n\n## Task\n${input.prompt}\n`;
  const args = ["--dangerously-skip-permissions"];
  if (input.model) args.push("--model", input.model);
  args.push("-p", fullPrompt);

  const ptyId = await deps.spawnAgent({ command: "claude", args, cwd: worktree, env: input.env });
  return { ptyId, branch, worktree };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/engine/dispatchTask.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/dispatchTask.ts src/lib/engine/dispatchTask.test.ts
git commit -m "feat(maintain): engine dispatchTask (worktree + agent, no plan gate)"
```

---

### Task 4: Maintain store state (mode + tasks + actions)

**Files:**
- Modify: `src/cadre/useCadre.ts` (slice type `CadreSlice`, `emptyBmadSlice()`, and new actions)
- Test: `src/cadre/maintainActions.test.ts` (pure orchestration extracted so it is testable without Tauri)
- Create: `src/lib/maintain/dispatchOrchestration.ts` (pure glue: given deps, create+dispatch a task and produce the status transitions)

**Interfaces:**
- Consumes: `dispatchTask` (Task 3), `makeTask`/`setTaskStatus`/`MaintainTask` (Task 2), `DispatchDeps`.
- Produces: `runMaintainTask(deps, { repoPath, worktreeRoot, id, prompt, env, model, onStatus }): Promise<void>` where `onStatus: (status: TaskStatus) => void` is called `"running"` on spawn success and `"failed"` on throw. (Slice 1 has no verify, so it stops at `running`.)
- New `CadreSlice` fields: `mode: ProjectMode` (default `"maintain"` is wrong for greenfield — default `"build"`, openProject overrides), `tasks: MaintainTask[]`.
- New store actions: `setMode(mode)`, `addMaintainTask(prompt)` (mints id, appends queued task, kicks off `runMaintainTask`).

- [ ] **Step 1: Write the failing test (pure orchestration)**

```ts
import { describe, it, expect, vi } from "vitest";
import { runMaintainTask } from "../lib/maintain/dispatchOrchestration";

describe("runMaintainTask", () => {
  it("marks running on a successful spawn", async () => {
    const deps = {
      runGit: vi.fn().mockResolvedValue(undefined),
      runGitQuery: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "" }),
      spawnAgent: vi.fn().mockResolvedValue(7),
    };
    const seen: string[] = [];
    await runMaintainTask(deps, { repoPath: "/r", worktreeRoot: "/r", id: "a", prompt: "p", onStatus: (s) => seen.push(s) });
    expect(seen).toEqual(["running"]);
  });
  it("marks failed when spawn throws", async () => {
    const deps = {
      runGit: vi.fn().mockResolvedValue(undefined),
      runGitQuery: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "" }),
      spawnAgent: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const seen: string[] = [];
    await runMaintainTask(deps, { repoPath: "/r", worktreeRoot: "/r", id: "a", prompt: "p", onStatus: (s) => seen.push(s) });
    expect(seen).toEqual(["failed"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cadre/maintainActions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `runMaintainTask`**

```ts
import { dispatchTask } from "../engine/dispatchTask";
import type { DispatchDeps } from "../engine/dispatch";
import type { TaskStatus } from "./tasks";

export async function runMaintainTask(
  deps: DispatchDeps,
  input: { repoPath: string; worktreeRoot: string; id: string; prompt: string; env?: Record<string, string>; model?: string; onStatus: (s: TaskStatus) => void },
): Promise<void> {
  try {
    await dispatchTask(deps, input);
    input.onStatus("running");
  } catch {
    input.onStatus("failed");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/cadre/maintainActions.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire store state + actions in `useCadre.ts` (no test — integration verified in Task 5)**

In `CadreSlice` add: `mode: ProjectMode;` and `tasks: MaintainTask[];`. In `emptyBmadSlice()` set `mode: "build", tasks: []`. Add actions:

```ts
setMode: (mode) => { const root = get().activeRoot; if (root) patchRoot(root, { mode }); },

addMaintainTask: async (prompt) => {
  const root = requireRoot();
  const id = Math.random().toString(36).slice(2, 8); // slice-1 id; replace with a Tauri uuid later
  const task = makeTask(id, prompt, Date.now());
  patchRoot(root, { tasks: [task, ...(get().projects[root]?.tasks ?? [])] });
  const repos = parseRepos(await readManifest(root));
  const repoPath = resolveRepoPath(root, findRepo(repos, DEFAULT_REPO_ID).path);
  const provider = getProvider(fleetProviderId());
  const { env, model } = await resolveFleetAuth(provider);
  const deps = { runGit, runGitQuery, spawnAgent }; // reuse the same deps object built for dispatchStory (see line ~760)
  await runMaintainTask(deps, {
    repoPath, worktreeRoot: root, id, prompt, env, model,
    onStatus: (s) => patchRoot(root, { tasks: setTaskStatus(get().projects[root]?.tasks ?? [], id, s) }),
  });
},
```

Add imports at the top of `useCadre.ts`: `import { detectProjectMode, type ProjectMode } from "../lib/engine/projectMode";`, `import { makeTask, setTaskStatus, type MaintainTask } from "../lib/maintain/tasks";`, `import { runMaintainTask } from "../lib/maintain/dispatchOrchestration";`. (`DEFAULT_REPO_ID`, `parseRepos`, `readManifest`, `resolveRepoPath`, `getProvider`, `fleetProviderId`, `resolveFleetAuth` are already imported/defined in this file.)

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/maintain/dispatchOrchestration.ts src/cadre/maintainActions.test.ts src/cadre/useCadre.ts
git commit -m "feat(maintain): store mode + tasks + runMaintainTask wiring"
```

---

### Task 5: MaintainView UI + open-flow routing (manual verification)

**Files:**
- Create: `src/cadre/MaintainView.tsx`, `src/cadre/maintain/TaskQueue.tsx`
- Modify: `src/stores/bmadStore.ts` (`openProject`: resolve + set mode), `src/cadre/CadreApp.tsx` (render `MaintainView` when mode === "maintain")

**Interfaces:**
- Consumes: `useCadre` (`mode`, `tasks`, `addMaintainTask`), `AgentOrgChart()`, `TerminalPanel({ cwd })`, `useBmadStore` (`projectRoot`).

- [ ] **Step 1: Build `TaskQueue.tsx`** — a panel with a prompt `<textarea>` + Send button (calls `addMaintainTask`), and a list of `tasks` grouped by status, each showing `#id`, prompt, a status pill (`--c-*` tokens; queued=muted, running=accent, verified=success, failed=warning). No dispatch logic here — purely presentational + the one `addMaintainTask` call.

- [ ] **Step 2: Build `MaintainView.tsx`** — a three-column flex/grid layout: `<TaskQueue />` | `<AgentOrgChart />` | `<TerminalPanel cwd={projectRoot} />`. Header reads "Maintain · <repo>". Use `--c-*` tokens and the same header style as `AgentOrgChart`'s toolbar.

- [ ] **Step 3: Resolve mode in `bmadStore.openProject`** — after the git-repo gate and `open_project`, detect greenfield artifacts and set the mode:

```ts
const hasPrd = await invoke<boolean>("path_exists", { path: `${root}/docs/prd.md` }).catch(() => false);
const storyDirEntries = await invoke<{ path: string; is_dir: boolean }[]>("list_dir", { path: `${root}/docs/stories` }).catch(() => []);
const hasStories = storyDirEntries.some((e) => e.path.endsWith(".md"));
useCadre.getState().setMode(detectProjectMode({ hasPrd, hasStories }));
```

(Confirm the exact Tauri command names for existence/listing by grepping `invoke(` in `bmadStore.ts`/`useCadre.ts`; substitute the project's actual `read_file`/`list_dir` equivalents. `newProject` should call `setMode("build")` explicitly after scaffolding.)

- [ ] **Step 4: Route in `CadreApp.tsx`** — read `const mode = useCadre((s) => s.mode);` and, in the render, when `projectRoot && mode === "maintain"`, return `<MaintainView />` instead of the orchestrator/studio shell (keep Settings/Team/Log chrome).

- [ ] **Step 5: Typecheck + full test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all tests pass.

- [ ] **Step 6: Manual verification (REQUIRED SUB-SKILL: superpowers:verification-before-completion)**

1. `npm run tauri dev`.
2. Open an **existing repo with no `docs/prd.md` and no `docs/stories/`** → the app shows **MaintainView** (3 panels), not the PlanningStudio.
3. Type a prompt (e.g. "add a comment to the README") → a task appears **queued → running**; the **Fleet** panel shows a live agent; a `task/<id>` worktree exists (`git worktree list` in the Terminal panel).
4. Open a **greenfield project (has `docs/prd.md`)** → the app still shows the PlanningStudio (mode `build`), confirming detection.

- [ ] **Step 7: Commit**

```bash
git add src/cadre/MaintainView.tsx src/cadre/maintain/TaskQueue.tsx src/stores/bmadStore.ts src/cadre/CadreApp.tsx
git commit -m "feat(maintain): MaintainView (task queue + fleet + terminal) + open-flow routing"
```

---

## Self-Review

**Spec coverage (against slice-1 decisions):**
- Open existing app → maintain view — Task 1 (detect) + Task 5 (openProject wiring + routing). ✓
- 3-panel layout reusing Fleet + Terminal — Task 5 (MaintainView embeds `AgentOrgChart` + `TerminalPanel`). ✓
- Ad-hoc prompt → task → real dispatch on `task/<id>` — Task 2 (model), Task 3 (engine), Task 4 (store/orchestration), Task 5 (UI). ✓
- Reuse low-level engine, avoid the plan gate — Task 3 uses `dispatch.ts` deps directly, never `runApprovedStory`. ✓
- Explicitly out of slice 1: error/log intake, triage, wedge verify, PR handoff — noted in Global Constraints; task terminal state is `running`. ✓

**Placeholder scan:** Two spots require confirming exact Tauri command names in Task 5 Step 3 (`path_exists`/`list_dir`) and reusing the existing `deps` object in Task 4 Step 5 — both are flagged inline with how to resolve (grep `invoke(` in the target files). No other placeholders.

**Type consistency:** `MaintainTask`, `TaskStatus`, `ProjectMode`, `DispatchDeps`, `DispatchTaskInput`/`Result`, `runMaintainTask` signatures are consistent across Tasks 2–5. `taskBranch(id)` → `"task/<id>"` and worktree `"/…/.cadre/worktrees/task-<id>"` are used identically in Task 3 and its test.
