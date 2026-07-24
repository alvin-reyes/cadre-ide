# Multi-Repo Dispatch (Polyrepo Product) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one Cadre project (its own committable git repo) orchestrate work across several code repos — each story targets a repo; dispatch runs the worktree/branch/verify/merge in that repo; the Cadre project only ever writes its own orchestration state, never the code repos.

**Architecture:** The Cadre project root stays the home of `docs/` + `.cadre/` (state, approvals, context, journal) and gains a `repos:` registry in `cadre.json`. Each code repo is referenced by path. A story declares a `Repo:` id; dispatch resolves it to a repo path and runs `git -C <repoPath> worktree add {projectRoot}/.cadre/worktrees/<repoId>/<e>.<s>` — the worktree lives under the Cadre project (gitignored) but is a worktree *of* the code repo, so code repos stay pristine. Verify commands are frozen per-repo at plan approval (engine-owned, agent-unforgeable). **Backward-compatible via the degenerate registry `[{id:"main", path:"."}]`** — an existing single-repo project routes every story to its own root exactly as today; no migration.

**Tech Stack:** Tauri v2 (Rust), React 19 + TypeScript, Zustand, Vitest, `cargo test`.

## Global Constraints

- Preserve all 148 frontend tests (`npx vitest run`) and Rust tests (`cd src-tauri && cargo test`) green after every task.
- **Backward compat is a hard requirement:** a project with no `repos` in `cadre.json` behaves EXACTLY as today. The default registry is `[{ id: "main", name: <project name>, path: "." }]`; a story with no `Repo:` field targets `"main"`; `path: "."` resolves to the project root. No existing project needs migration.
- Cadre must NEVER write into a code repo except through the dispatch worktree/branch/merge it manages. No `.cadre/` files land in a code repo (worktrees live under the Cadre project).
- Per-repo verify stays **engine-frozen**: the verify command a story is judged against comes from the PLAN approval (Rust-owned), NOT from `cadre.json` at dispatch time (an agent could edit `cadre.json`). The registry only *pre-fills* the approval UI.
- `DEFAULT_REPO_ID = "main"` is the single source of truth for the default repo id — import it, never hardcode `"main"`.

---

## File Structure

- `src/lib/engine/repos.ts` *(new)* — pure registry model: `RepoRef`, `DEFAULT_REPO_ID`, `parseRepos`, `resolveRepoPath`, `repoWorktreePath`, `findRepo`. Unit-tested; no Tauri.
- `src/lib/engine/shard.ts` — `StoryContent.repo`, `composeStoryFile` writes a `## Repo` section, new `parseStoryRepo`.
- `src/lib/engine/dispatch.ts` — dispatch runs repo-management git in the code repo; worktree path namespaced by repo id.
- `src/lib/engine/integrate.ts` — merge-back runs in the code repo.
- `src/lib/engine/runStory.ts`, `orchestrator.ts` — thread `repoPath` + per-repo verify.
- `src-tauri/src/cadre_state.rs` — `PlanApproval.repo_verification`; `approve_plan` takes it.
- `src/lib/engine/planApproval.ts` — mirror the new field.
- `src/lib/engine/schedule.ts` usage — repo-namespaced file keys (change is at the call site in useCadre, not schedule.ts itself).
- `src/stores/reposStore.ts` *(new)* — load/edit the registry; write `cadre.json`.
- `src/cadre/useCadre.ts` — resolve a story's repo, pass repoPath + per-repo verify into dispatch; per-repo scheduling keys; per-repo verify at approval.
- `src/cadre/RepoRegistry.tsx` *(new)* — add/remove repos + per-repo verify UI.
- Board card repo chip + shard repo selector: `src/cadre/FleetView.tsx` (+ wherever `StoryCard` is rendered).

---

## Phase A — Repo registry model (pure)

### Task 1: `repos.ts` — parse + resolve the registry

**Files:**
- Create: `src/lib/engine/repos.ts`
- Test: `src/lib/engine/repos.test.ts`

**Interfaces — Produces:**
```ts
export interface RepoRef { id: string; name: string; path: string; verify?: string }
export const DEFAULT_REPO_ID = "main";
// Parse cadre.json text → repos. Missing/empty `repos` yields the degenerate single-repo
// registry [{ id:"main", name: manifest.name ?? "main", path:"." }]. Tolerant of bad JSON.
export function parseRepos(manifestJson: string): RepoRef[];
// path "." → projectRoot; relative → normalized join under projectRoot; absolute → as-is.
export function resolveRepoPath(projectRoot: string, path: string): string;
// {projectRoot}/.cadre/worktrees/{repoId}/{epic}.{story}
export function repoWorktreePath(projectRoot: string, repoId: string, epic: number, story: number): string;
// Find by id; fall back to the first repo (never throws on a stale id).
export function findRepo(repos: RepoRef[], id: string): RepoRef;
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseRepos, resolveRepoPath, repoWorktreePath, findRepo, DEFAULT_REPO_ID } from "./repos";

describe("repos registry", () => {
  it("defaults to a single 'main' repo at '.' when no repos are declared", () => {
    expect(parseRepos('{"name":"Acme"}')).toEqual([{ id: "main", name: "Acme", path: "." }]);
    expect(parseRepos("not json")).toEqual([{ id: "main", name: "main", path: "." }]);
  });

  it("parses a declared repo list", () => {
    const json = JSON.stringify({ name: "Acme", repos: [
      { id: "web", name: "Web", path: "../acme-web", verify: "npm test" },
      { id: "api", path: "../acme-api" },
    ]});
    expect(parseRepos(json)).toEqual([
      { id: "web", name: "Web", path: "../acme-web", verify: "npm test" },
      { id: "api", name: "api", path: "../acme-api" },
    ]);
  });

  it("resolves paths: '.' → root, relative → joined, absolute → itself", () => {
    expect(resolveRepoPath("/proj", ".")).toBe("/proj");
    expect(resolveRepoPath("/proj", "../web")).toBe("/web");
    expect(resolveRepoPath("/proj", "/abs/api")).toBe("/abs/api");
  });

  it("namespaces worktrees by repo id", () => {
    expect(repoWorktreePath("/proj", "web", 1, 2)).toBe("/proj/.cadre/worktrees/web/1.2");
  });

  it("findRepo falls back to the first repo on an unknown id", () => {
    const repos = [{ id: "web", name: "Web", path: "../w" }, { id: "api", name: "api", path: "../a" }];
    expect(findRepo(repos, "api").id).toBe("api");
    expect(findRepo(repos, "ghost").id).toBe("web");
    expect(findRepo([], DEFAULT_REPO_ID)).toEqual({ id: "main", name: "main", path: "." });
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`Cannot find module './repos'`): `npx vitest run src/lib/engine/repos.test.ts`

- [ ] **Step 3: Implement `repos.ts`**

```ts
export interface RepoRef { id: string; name: string; path: string; verify?: string }
export const DEFAULT_REPO_ID = "main";

export function parseRepos(manifestJson: string): RepoRef[] {
  let manifest: { name?: string; repos?: unknown } = {};
  try { manifest = JSON.parse(manifestJson) ?? {}; } catch { /* fall through to default */ }
  const name = typeof manifest.name === "string" && manifest.name ? manifest.name : DEFAULT_REPO_ID;
  const raw = Array.isArray(manifest.repos) ? manifest.repos : [];
  const repos: RepoRef[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.path !== "string") continue;
    repos.push({
      id: o.id,
      name: typeof o.name === "string" && o.name ? o.name : o.id,
      path: o.path,
      ...(typeof o.verify === "string" && o.verify ? { verify: o.verify } : {}),
    });
  }
  return repos.length > 0 ? repos : [{ id: DEFAULT_REPO_ID, name, path: "." }];
}

export function resolveRepoPath(projectRoot: string, path: string): string {
  if (path === "." || path === "") return projectRoot;
  if (path.startsWith("/")) return path;
  // POSIX join + normalize (../, ./) — the app runs on macOS/Linux paths.
  const parts = `${projectRoot}/${path}`.split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return "/" + out.join("/");
}

export function repoWorktreePath(projectRoot: string, repoId: string, epic: number, story: number): string {
  return `${projectRoot}/.cadre/worktrees/${repoId}/${epic}.${story}`;
}

export function findRepo(repos: RepoRef[], id: string): RepoRef {
  return repos.find((r) => r.id === id) ?? repos[0] ?? { id: DEFAULT_REPO_ID, name: DEFAULT_REPO_ID, path: "." };
}
```

- [ ] **Step 4: Run — expect PASS.** `npx vitest run src/lib/engine/repos.test.ts`
- [ ] **Step 5: Commit** — `git add src/lib/engine/repos.ts src/lib/engine/repos.test.ts && git commit -m "feat(repos): pure registry model — parse, resolve, worktree path"`

---

## Phase B — Per-story repo field

### Task 2: story markdown carries a `Repo:` id

**Files:**
- Modify: `src/lib/engine/shard.ts` (`StoryContent`, `composeStoryFile`, new `parseStoryRepo`)
- Test: `src/lib/engine/shard.test.ts` (existing file — add cases)

**Interfaces:**
- Consumes: `DEFAULT_REPO_ID` from `./repos`.
- Produces: `StoryContent.repo?: string`; `composeStoryFile` emits a `## Repo\n\n<repo>\n` section (defaulting to `DEFAULT_REPO_ID`); `parseStoryRepo(markdown: string): string` reads it back (default `DEFAULT_REPO_ID`).

- [ ] **Step 1: Write failing tests** (append to `shard.test.ts`)

```ts
import { parseStoryRepo, composeStoryFile } from "./shard";
import { DEFAULT_REPO_ID } from "./repos";

it("composeStoryFile writes a Repo section and parseStoryRepo reads it", () => {
  const md = composeStoryFile({
    epic: 1, story: 2, title: "Auth", repo: "api",
    userStory: { role: "u", action: "a", benefit: "b" },
    acceptanceCriteria: ["x"], tasks: ["t"], devNotes: "n", files: [],
  });
  expect(md).toContain("## Repo");
  expect(parseStoryRepo(md)).toBe("api");
});

it("parseStoryRepo defaults to the main repo when absent", () => {
  expect(parseStoryRepo("# Story 1.1\n\n## Status\n\nDraft\n")).toBe(DEFAULT_REPO_ID);
});

it("composeStoryFile defaults the repo section to main", () => {
  const md = composeStoryFile({
    epic: 1, story: 1, title: "T", userStory: { role: "u", action: "a", benefit: "b" },
    acceptanceCriteria: [], tasks: [], devNotes: "", files: [],
  });
  expect(parseStoryRepo(md)).toBe(DEFAULT_REPO_ID);
});
```

- [ ] **Step 2: Run — expect FAIL** (`parseStoryRepo` not exported): `npx vitest run src/lib/engine/shard.test.ts`

- [ ] **Step 3: Implement**

In `shard.ts`, add the import and field:
```ts
import { DEFAULT_REPO_ID } from "./repos";
// in StoryContent:
  /** the code repo this story targets (registry id); defaults to the main repo. */
  repo?: string;
```
In `composeStoryFile`, after the title heading block and before `## Status` (so it's stable and near the top), insert:
```ts
  parts.push("## Repo");
  parts.push("");
  parts.push(input.repo ?? DEFAULT_REPO_ID);
  parts.push("");
```
Add the parser (mirror `parseStoryFiles`'s section regex):
```ts
/** Read the "## Repo" section (a bare repo id), or the default repo when absent. */
export function parseStoryRepo(markdown: string): string {
  const m = markdown.match(/^##\s*Repo[^\n]*\n+([^\n]+)/m);
  const id = m?.[1]?.trim();
  return id && id.length > 0 ? id : DEFAULT_REPO_ID;
}
```

- [ ] **Step 4: Run — expect PASS** (and the existing shard tests stay green): `npx vitest run src/lib/engine/shard.test.ts`
- [ ] **Step 5: Commit** — `git commit -am "feat(shard): stories declare a target repo (## Repo)"`

---

## Phase C — Dispatch routing by repo

### Task 3: dispatch + integrate run in the code repo

**Files:**
- Modify: `src/lib/engine/dispatch.ts`, `src/lib/engine/integrate.ts`
- Test: `src/lib/engine/dispatch.test.ts`, `src/lib/engine/integrate.test.ts`

**Interfaces:**
- `storyWorktreePath` is REPLACED by `repos.ts`'s `repoWorktreePath(projectRoot, repoId, epic, story)`. `dispatch.ts` re-exports nothing new for it — call sites import from `repos.ts`.
- `DispatchInput` gains: `repoPath: string` (the code repo git dir) and `repoId: string`. `root` keeps meaning "the Cadre project root" (where `.cadre/worktrees` live). For a `path:"."` repo, `repoPath === root`.
- **Repo-management git** (`worktree remove/prune`, `branch -D`, `worktree add`) runs in `repoPath`. The per-worktree git (`add`/`commit` in `runStory`) runs in the worktree path. `integrateStory` gains `repoPath` and merges there.

- [ ] **Step 1: Update the dispatch test first (RED via assertion change)**

In `dispatch.test.ts`, the existing "creates a per-story worktree" test asserts `calls.git` with `cwd: "/proj"`. Change the expected worktree path and cwd to the repo, and add `repoPath`/`repoId` to the input. New expectations:
```ts
await dispatchStory(deps, {
  root: "/proj", repoPath: "/proj", repoId: "main",
  epic: 1, story: 2, prompt: "PROMPT",
});
expect(calls.git).toEqual([
  { args: ["worktree", "remove", "--force", "/proj/.cadre/worktrees/main/1.2"], cwd: "/proj" },
  { args: ["worktree", "prune"], cwd: "/proj" },
  { args: ["branch", "-D", "story/1.2"], cwd: "/proj" },
  { args: ["worktree", "add", "-b", "story/1.2", "/proj/.cadre/worktrees/main/1.2", "HEAD"], cwd: "/proj" },
]);
```
Add a second test for a NON-default repo proving the git cwd is the code repo, not the project root:
```ts
it("routes worktree git to the story's code repo", async () => {
  const { deps, calls } = recordingDeps();
  await dispatchStory(deps, { root: "/proj", repoPath: "/code/api", repoId: "api", epic: 2, story: 1, prompt: "P" });
  expect(calls.git[0]).toEqual({ args: ["worktree", "remove", "--force", "/proj/.cadre/worktrees/api/2.1"], cwd: "/code/api" });
  expect(calls.git.at(-1)).toEqual({ args: ["worktree", "add", "-b", "story/2.1", "/proj/.cadre/worktrees/api/2.1", "HEAD"], cwd: "/code/api" });
  expect(calls.spawn[0].cwd).toBe("/proj/.cadre/worktrees/api/2.1");
});
```

- [ ] **Step 2: Run — expect FAIL:** `npx vitest run src/lib/engine/dispatch.test.ts`

- [ ] **Step 3: Implement in `dispatch.ts`**

Replace `storyWorktreePath` usage with the repo-namespaced path and route git to `repoPath`:
```ts
import { repoWorktreePath } from "./repos";
// DispatchInput: add
  repoPath: string;  // the code repo the story targets ( === root when path:"." )
  repoId: string;
// in dispatchStory:
  const branch = storyBranch(input.epic, input.story);
  const worktree = repoWorktreePath(input.root, input.repoId, input.epic, input.story);
  const tryGit = async (args: string[]) => { try { await deps.runGit(args, input.repoPath); } catch { /* nothing to clean */ } };
  await tryGit(["worktree", "remove", "--force", worktree]);
  await tryGit(["worktree", "prune"]);
  await tryGit(["branch", "-D", branch]);
  await deps.runGit(["worktree", "add", "-b", branch, worktree, "HEAD"], input.repoPath);
  // ... (session/model args unchanged) ...
  const ptyId = await deps.spawnAgent({ command: "claude", args, cwd: worktree, env: input.env });
  return { ptyId, branch, worktree };
```
Keep `storyBranch`; delete the now-unused `storyWorktreePath` export (grep first — Step 4).

- [ ] **Step 4: Fix `integrate.ts`** — merge in the code repo

Add `repoPath` to `IntegrateInput` and merge there (the branch lives in the code repo now):
```ts
export interface IntegrateInput { root: string; repoPath: string; epic: number; story: number }
// in integrateStory: replace both `input.root` args with `input.repoPath`
  await deps.runGit([...IDENT, "merge", "--no-ff", "-m", msg, branch], input.repoPath);
  // ... abort also in input.repoPath
```
Update `integrate.test.ts`: pass `repoPath` and assert the merge/abort `cwd` is the repo path.

- [ ] **Step 5: Grep for stale `storyWorktreePath`** and update or remove:
`cd /Users/alvin-reyes/Project/aride && grep -rn "storyWorktreePath" src/` — expect no remaining references after this task (the only caller is dispatch itself). If a test referenced it, delete that.

- [ ] **Step 6: Run — expect PASS.** `npx vitest run src/lib/engine/dispatch.test.ts src/lib/engine/integrate.test.ts`
- [ ] **Step 7: Commit** — `git commit -am "feat(dispatch): route worktree/branch/merge to the story's code repo"`

### Task 4: thread repoPath + per-repo verify through runStory/orchestrator

**Files:**
- Modify: `src/lib/engine/runStory.ts`, `src/lib/engine/orchestrator.ts`
- Test: `src/lib/engine/runStory.test.ts` (existing)

**Interfaces:**
- `RunStoryInput` and `RunApprovedStoryInput` gain `repoPath: string` and `repoId: string`. `runStory` passes them to `dispatchStory`. `integrateStory` is called by useCadre (not runStory), so no change there beyond Task 3.
- `runApprovedStory` selects the verify commands for the story's repo: `const commands = approval.repoVerification?.[input.repoId] ?? approval.verification;` (the `repoVerification` field lands in Task 5; until then this is `?? approval.verification`, i.e. unchanged behavior).

- [ ] **Step 1: Update runStory.test.ts** — the fake deps' `dispatchStory` path now receives `repoPath`; add `repoPath: "/proj", repoId: "main"` to the test input and assert the worktree/commit `cwd` still resolves. (The existing tests build `RunStoryInput`; add the two fields.) Run — expect FAIL on the missing fields (tsc) or on assertions.
- [ ] **Step 2: Implement** — add `repoPath`/`repoId` to both input interfaces; in `runStory`, pass `repoPath`, `repoId` into the `dispatchStory({...})` call (the `add -A`/`commit` in the worktree already uses `dispatch.worktree` as cwd — unchanged and correct). Remove the Task-3 shim (`repoPath: input.root, repoId: "main"`) — the values now come from the input. In `orchestrator.ts`, forward both fields into `runStory` and select `commands = approval.repoVerification?.[input.repoId] ?? approval.verification`.
- [ ] **Step 3: Close the reviewFleet worktree gap (REQUIRED — a Task-3 reviewer caught this).** `reviewFleet.ts` currently hardcodes `"main"` when computing the review worktree path (`repoWorktreePath(input.root, "main", …)` ~line 88), so a non-`main` story would be reviewed in the WRONG worktree. Add `repoId: string` to `ReviewFleetInput` and replace the `"main"` literal with `input.repoId`. Update `reviewFleet.test.ts` to pass `repoId` and assert the namespaced worktree path. (The `useCadre.reviewStory` call site is wired in Task 6.) Grep `\brepoWorktreePath\(.*"main"` and `"main"` in `reviewFleet.ts` to confirm no hardcode remains.
- [ ] **Step 4: Run — expect PASS.** `npx vitest run src/lib/engine`
- [ ] **Step 5: Commit** — `git commit -am "feat(engine): thread repoPath + per-repo verify + review repoId through the engine"`

---

## Phase D — Per-repo frozen verify (Rust + approval)

### Task 5: `PlanApproval.repo_verification`

**Files:**
- Modify: `src-tauri/src/cadre_state.rs` (`PlanApproval`, `approve_plan`, the `approve_plan` command)
- Modify: `src/lib/engine/planApproval.ts` (mirror the field)
- Test: `src-tauri/src/cadre_state.rs` tests

**Interfaces:**
- Rust `PlanApproval` gains `#[serde(default)] pub repo_verification: HashMap<String, Vec<String>>`. `approve_plan(&self, verification, repo_verification)`; the command `approve_plan(engine, root, verification, repo_verification)`.
- TS `PlanApproval` gains `repoVerification?: Record<string, string[]>` — note serde renames: add `#[serde(rename_all = "camelCase")]` to the struct OR name the Rust field `repo_verification` and the TS field `repo_verification`. **Decision: use `#[serde(rename = "repoVerification")]` on the Rust field** so the TS side reads `approval.repoVerification` (camelCase, matching the rest of the TS types).

- [ ] **Step 1: Add a Rust test** in the `#[cfg(test)]` module:
```rust
#[test]
fn approve_plan_persists_per_repo_verification() {
    let state = CadreState::new(tmp_root("repo-verify"));
    let mut map = std::collections::HashMap::new();
    map.insert("api".to_string(), vec!["go test ./...".to_string()]);
    state.approve_plan(vec!["npm test".to_string()], map.clone()).unwrap();
    let got = state.get_plan_approval().unwrap().unwrap();
    assert_eq!(got.verification, vec!["npm test".to_string()]);
    assert_eq!(got.repo_verification.get("api"), Some(&vec!["go test ./...".to_string()]));
}
```
Run — expect FAIL (signature mismatch): `cd src-tauri && cargo test`

- [ ] **Step 2: Implement in `cadre_state.rs`**
```rust
use std::collections::HashMap; // already imported for the engine map
#[derive(serde::Serialize, serde::Deserialize)]
pub struct PlanApproval {
    pub approved: bool,
    pub verification: Vec<String>,
    #[serde(default, rename = "repoVerification")]
    pub repo_verification: HashMap<String, Vec<String>>,
}
// method:
pub fn approve_plan(&self, verification: Vec<String>, repo_verification: HashMap<String, Vec<String>>) -> Result<(), String> {
    let approval = PlanApproval { approved: true, verification, repo_verification };
    let json = serde_json::to_string_pretty(&approval).map_err(|e| e.to_string())?;
    self.atomic_write(&self.plan_path(), &json)
}
// command (root already added in the multi-project refactor):
#[tauri::command]
pub fn approve_plan(engine: tauri::State<'_, CadreEngine>, root: String, verification: Vec<String>, repo_verification: HashMap<String, Vec<String>>) -> Result<(), String> {
    let guard = engine.states.lock().unwrap();
    let state = guard.get(&PathBuf::from(&root)).ok_or("project not open")?;
    state.approve_plan(verification, repo_verification)
}
```
(The `#[serde(default)]` keeps OLD `plan.json` files — which lack the field — loading fine: backward compat.)

- [ ] **Step 3: Mirror in `planApproval.ts`**
```ts
export interface PlanApproval {
  approved: boolean;
  verification: string[];
  /** frozen verify commands per code-repo id; falls back to `verification`. */
  repoVerification?: Record<string, string[]>;
}
```

- [ ] **Step 4: Run — expect PASS.** `cd src-tauri && cargo test` (new test green, others unchanged).
- [ ] **Step 5: Commit** — `git commit -am "feat(engine): freeze per-repo verify commands in the plan approval"`

### Task 6: useCadre resolves repo + passes repoPath/verify; approval collects per-repo verify

**Files:**
- Modify: `src/cadre/useCadre.ts`
- Modify: `src/stores/reposStore.ts` *(new — see Task 7; if doing Task 6 first, read the registry inline via `parseRepos` and defer the store)*

**Interfaces:**
- Consumes: `parseRepos`, `resolveRepoPath`, `findRepo`, `DEFAULT_REPO_ID`, `parseStoryRepo`.
- `dispatchStory(epic, story)`: after reading the story markdown, compute `const repoId = parseStoryRepo(storyMarkdown); const repos = parseRepos(await readCadreJson(root)); const repo = findRepo(repos, repoId); const repoPath = resolveRepoPath(root, repo.path);` and pass `repoPath`, `repoId` into `runApprovedStory` and into `integrateStory({ root, repoPath, epic, story })`.
- `approve_plan` invoke: pass `repoVerification` built from the registry (each repo's `verify`, defaulting to the detected/default command). Foreground UI (Task 8) provides the editable map; here just thread it.

- [ ] **Step 1: Add a `readManifest(root)` helper** in useCadre: `invoke<string>("read_file", { path: `${root}/cadre.json` }).catch(() => "")`.
- [ ] **Step 2: In `dispatchStory`**, after `storyMarkdown` is read, resolve the repo and pass it through:
```ts
const repoId = parseStoryRepo(storyMarkdown);
const repos = parseRepos(await readManifest(root));
const repoPath = resolveRepoPath(root, findRepo(repos, repoId).path);
// pass into runApprovedStory: repoPath, repoId
// pass into integrateStory: { root, repoPath, epic, story }  (removes the Task-3 shim)
// pass the captured repoId into the review gate: get().reviewStory(epic, story, root, repoId)
```

- [ ] **Step 2b: Thread `repoId` into `reviewStory` (closes the reviewFleet gap).** `reviewStory(epic, story, root?, repoId?)`: resolve `const rid = repoId ?? parseStoryRepo(await getStoryMarkdown(epic, story))` so a foreground (UI-triggered) review also finds the right worktree, and pass `repoId: rid` into the `reviewStoryFleet({ root, epic, story, repoId: rid })` call (the `ReviewFleetInput.repoId` field added in Task 4). The dispatch gate (Step 2) passes its captured `repoId` so a background review never re-resolves against the foreground.
- [ ] **Step 3: In `approvePlan`**, build `repoVerification` from the registry and pass it to the invoke:
```ts
const repos = parseRepos(await readManifest(root));
const repoVerification: Record<string, string[]> = {};
for (const r of repos) if (r.verify?.trim()) repoVerification[r.id] = [r.verify.trim()];
await invoke("approve_plan", { root, verification: cmds, repoVerification });
```
- [ ] **Step 4: Repo-namespaced scheduling** — in `dispatchReady`, when building the scheduler input, prefix each story's declared files with its repo id so two stories in different repos never collide:
```ts
const repos = parseRepos(await readManifest(root));
// per story c:
const md = ...;
const repoId = parseStoryRepo(md);
return { id: c.id, files: parseStoryFiles(md).map((f) => `${repoId}:${f}`) };
```
(`scheduleParallel` treats the strings opaquely, so no change to `schedule.ts`.)
- [ ] **Step 5: Typecheck + tests.** `npx tsc --noEmit && npx vitest run` — 148 + new. Fix any dispatch call sites that now need `repoPath`/`repoId`.
- [ ] **Step 6: Commit** — `git commit -am "feat(fleet): dispatch resolves each story's repo; approval freezes per-repo verify"`

---

## Phase E — Registry store + UI

### Task 7: `reposStore` — load/edit the registry, write `cadre.json`

**Files:**
- Create: `src/stores/reposStore.ts`
- Test: `src/stores/reposStore.test.ts` (pure merge/update ops only)

**Interfaces — Produces:** `useRepos` with `repos: RepoRef[]`, `load(root)`, `addRepo(root, repo)`, `removeRepo(root, id)`, `setVerify(root, id, verify)`. Pure helpers `upsertRepo(list, repo)` and `removeRepoFromList(list, id)` are unit-tested. Writing persists the FULL `cadre.json` (preserving other keys) via `write_text_file`.

- [ ] **Step 1: Failing test for the pure ops**
```ts
import { upsertRepo, removeRepoFromList } from "./reposStore";
it("upsertRepo adds or replaces by id", () => {
  const a = upsertRepo([], { id: "web", name: "Web", path: "../w" });
  expect(a).toHaveLength(1);
  const b = upsertRepo(a, { id: "web", name: "Web2", path: "../w" });
  expect(b).toEqual([{ id: "web", name: "Web2", path: "../w" }]);
});
it("removeRepoFromList drops by id", () => {
  expect(removeRepoFromList([{ id: "web", name: "W", path: "." }], "web")).toEqual([]);
});
```
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** the pure ops + the Zustand store. `load(root)` reads `cadre.json`, `parseRepos`, sets `repos`. Mutations recompute the list, then read the raw manifest, splice `repos`, and `write_text_file` the merged JSON back (preserve `name` and any other keys). Keep the pure ops exported and framework-free.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(stores): repo registry store (cadre.json read/write)"`

### Task 8: Registry UI + repo chip + shard selector + per-repo verify at approval

**Files:**
- Create: `src/cadre/RepoRegistry.tsx`
- Modify: `src/cadre/FleetView.tsx` (repo chip on cards; repo selector in the shard toolbar; per-repo verify in the approval control)

**Interfaces:** Consumes `useRepos`, `parseStoryRepo`. This is UI wiring; no unit tests (GUI). Gated by tsc + vitest (regression) + `npm run build`.

- [ ] **Step 1: `RepoRegistry.tsx`** — a panel listing `useRepos().repos` with add (id/name/path/verify), remove, and inline verify edit; reuses the token styles from `TerminalTabs`/`Settings`. Reachable from Settings or a project menu.
- [ ] **Step 2: Repo chip on board cards** — render `parseStoryRepo(storyMarkdown)` (or a `repo` field on `StoryCard`) as a small chip; hide the chip when there is only the single `main` repo (so single-repo projects look unchanged).
- [ ] **Step 3: Shard repo selector** — in the shard toolbar (beside the epic selector), a repo `<select>` shown only when `repos.length > 1`; the chosen repo id is passed into story generation so `composeStoryFile` writes the right `## Repo` (thread it through `shardNextStory`/the story tool like the epic number already is).
- [ ] **Step 4: Per-repo verify at approval (REQUIRED — closes a Task-6 reviewer finding)** — when `repos.length > 1`, the approval control shows one verify input per repo (pre-filled from each repo's registry `verify`); these populate the `repoVerification` map passed to `approve_plan` (Task 6 Step 3). **Every registered repo MUST have a non-empty verify command before the plan can be approved** (disable/block "Approve" until each repo has one, with an inline "set a verify command for <repo>" message). Rationale: a non-`main` repo with no frozen per-repo verify falls back to the GLOBAL `approval.verification` (which is the `main` repo's command, since `detectProjectVerify` reads only the project root) — so its stories would be silently judged against the WRONG repo's tests. Requiring a per-repo verify eliminates that fallback for real multi-repo projects. (Single-repo is unaffected: the lone `main` repo uses the global verify exactly as today; the requirement only applies when `repos.length > 1`.)
- [ ] **Step 5: Verify** — `npx tsc --noEmit && npx vitest run && npm run build` all green.
- [ ] **Step 6: Manual checklist (document for the human):** create a Cadre project; register a second repo at `../other`; shard a story targeting it; dispatch; confirm the worktree is created under `{project}/.cadre/worktrees/<id>/…` as a worktree of `../other`, the frozen per-repo verify runs, and merge-back lands in `../other` — with the code repo otherwise untouched. Confirm a single-repo project (no `repos`) behaves exactly as before.
- [ ] **Step 7: Commit** — `git commit -am "feat(ui): repo registry, board repo chips, shard repo selector, per-repo verify"`

---

## Self-Review

**Spec coverage:**
- Cadre project references code repos by path → Task 1 (registry) + Task 7 (store) + Task 8 (UI). ✓
- Per-story repo → Task 2. ✓
- Dispatch worktree/branch/merge in the code repo, worktree under the Cadre project → Task 3. ✓
- Per-repo frozen verify (engine-owned) → Task 5 (Rust) + Task 6 (thread) + Task 8 (collect). ✓
- Code repos untouched except managed worktree/branch/merge → Task 3 (git `-C repoPath`, worktree under project). ✓
- Repo-aware parallel scheduling → Task 6 Step 4. ✓
- Backward compat (single-repo `path:"."`, no `Repo:` field, old `plan.json`) → Task 1 default registry, Task 2 default id, Task 5 `#[serde(default)]`. ✓

**Type consistency:** `RepoRef`/`DEFAULT_REPO_ID`/`parseRepos`/`resolveRepoPath`/`repoWorktreePath`/`findRepo`/`parseStoryRepo` used identically across tasks. `repoPath`+`repoId` added to `DispatchInput`, `RunStoryInput`, `RunApprovedStoryInput`, `IntegrateInput` with the same names. Rust field `repo_verification` serializes as `repoVerification`; TS reads `approval.repoVerification`; `runApprovedStory` selects `approval.repoVerification?.[repoId] ?? approval.verification`.

**Known v1 limitations (documented, not gaps):**
- Cross-repo *atomic* merges aren't attempted — a story spanning two repos should be split into two stories (one per repo) coordinated via the Context Store. Stated, matches the polyrepo model.
- No per-repo remote/push automation — merge-back lands in the local code repo's main; pushing stays the user's action (consistent with today).
- The onboarding wizard (registering + documenting existing repos, reconstructed draft PRD) is **Plan 2**, not covered here.

**Placeholder scan:** none — every code step carries the actual code; the UI task (8) is inherently descriptive but each sub-step names the exact file, control, and data it wires, gated by build + regression tests.
