# GitHub Tracker Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Push Cadre's engine-verified story status to GitHub Issues — when the engine marks a story Done (only after the frozen verification command passes), the linked issue closes with a comment citing the command that passed. "Verified, not vibed," pushed to the tracker.

**Architecture:** One-way push (Cadre → GitHub) via the `gh` CLI (reuses the user's existing `gh auth`; no token stored in Cadre). A pure `githubTracker.ts` module maps story+status → `gh` API calls with an injected runner. A `run_gh` Rust command shells out to `gh`. A `trackerStore` persists the story↔issue mapping + config in `.cadre/tracker.json` and is invoked from the engine-owned `setStatus` write. Settings gets a GitHub-tracker section.

**Tech Stack:** React 19 + TS, Zustand, Vitest, Rust/Tauri, the `gh` CLI.

## Global Constraints

- Preserve all 271 frontend tests + `cargo test` green + tsc + build after every task.
- **One-way only** (Cadre → GitHub) for v1. No polling/inbound sync.
- Transport is the `gh` CLI via `gh api` (JSON, parseable). NEVER store a GitHub token in Cadre, localStorage, or commits — `gh` owns auth.
- Tracker sync must be **best-effort and non-blocking**: a GitHub failure NEVER blocks or rolls back a status transition. All failures surface via `reportError` only.
- `.cadre/tracker.json` is engine-adjacent state, committed (it's the shared story↔issue map).
- Disabled by default: no network calls unless the user enables the tracker for a project.

---

## File Structure

- `src-tauri/src/verify.rs` (or a new `gh.rs`) — `run_gh(cwd, args)` Tauri command, mirroring `run_git`. Registered in `lib.rs` `generate_handler!`.
- `src/lib/integrations/githubTracker.ts` *(new)* — pure: status→state mapping, title/body/comment composition, and `syncStory`/`ensureIssue` orchestration over an injected `GhRunner`. Unit-tested.
- `src/stores/trackerStore.ts` *(new)* — load/save `.cadre/tracker.json`, detect the repo from the git remote, enable flag, `syncStory`/`syncAll` wrappers wiring `run_gh` → the pure core.
- `src/stores/bmadStore.ts` — after the engine `setStatus` write succeeds, fire tracker sync (non-blocking) when enabled.
- `src/cadre/Settings.tsx` — a "GitHub tracker" `<Section>`: enable toggle, repo (auto-detected, editable), `gh` auth status, "Sync all" button.

---

## Task 1: `run_gh` Tauri command

**Files:** `src-tauri/src/verify.rs` (add the command next to `run_git`), `src-tauri/src/lib.rs` (register).

- [ ] **Step 1: Add the command.** Mirror `run_git` (verify.rs:111-…). Add:
  ```rust
  #[tauri::command]
  pub fn run_gh(cwd: String, args: Vec<String>) -> Result<VerificationResult, String> {
      // same impl shape as run_git but the program is "gh"
  }
  ```
  It runs `gh <args...>` in `cwd`, capturing stdout/stderr/exit code into `VerificationResult` (reuse that struct — it already carries stdout/stderr/exit; confirm field names by reading `run_git`). Do NOT hardcode a token or any auth — `gh` reads its own config.
- [ ] **Step 2: Register** in `lib.rs` `generate_handler![…]` (add `run_gh` alongside `run_git`).
- [ ] **Step 3: A cheap Rust test** (verify.rs `#[cfg(test)]`): call the underlying runner with a program that exists (or gate on `gh` presence). Minimal — mirror an existing `run_command` test. If `gh` may be absent in CI, test the arg-plumbing via a stub command instead of asserting `gh` output.
- [ ] **Step 4: Verify** `cargo test` green; `cargo build` clean.
- [ ] **Step 5: Commit** — `feat(tracker): run_gh Tauri command (shell out to the gh CLI)`

## Task 2: Pure tracker core (`githubTracker.ts`)

**Files:** Create `src/lib/integrations/githubTracker.ts` + `githubTracker.test.ts`.

**Interfaces — Produces:**
```ts
export type GhRunner = (args: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
export interface TrackerStory { epic: number; story: number; title: string; acceptanceCriteria?: string; }
export type TrackerStatus = "Draft" | "Approved" | "InProgress" | "InReview" | "Done" | "Failed" | "Blocked";
export interface SyncStoryInput {
  repo: string;                 // "owner/repo"
  story: TrackerStory;
  status: TrackerStatus;
  verifyCmd?: string;           // the frozen verification command (for the Done comment)
  issueNumber?: number;         // existing mapping, if any
}
export interface SyncStoryResult { issueNumber: number; }
export function issueTitle(s: TrackerStory): string;              // e.g. "[1.2] Add login form"
export function issueBody(s: TrackerStory): string;              // acceptance criteria + a "Tracked by Cadre" footer
export function statusIsClosed(status: TrackerStatus): boolean;  // true only for "Done"
export function transitionComment(status: TrackerStatus, verifyCmd?: string): string; // Done → "✅ Verified by Cadre — the frozen verification command `<cmd>` passed." else "Cadre: status → <status>"
export async function syncStory(gh: GhRunner, input: SyncStoryInput): Promise<SyncStoryResult>;
```

- [ ] **Step 1: Write failing tests** (`githubTracker.test.ts`) with a fake `GhRunner` that records calls and returns canned JSON:
  - `issueTitle`/`issueBody` formatting (title includes `[epic.story]`; body includes acceptance criteria + the Cadre footer).
  - `statusIsClosed`: only `"Done"` → true.
  - `transitionComment`: `"Done"` with a cmd → contains "Verified" + the command; other statuses → contains the status name.
  - `syncStory` with NO `issueNumber` → calls `gh api repos/{repo}/issues -f title=… -f body=…` (create), parses `.number` from the returned JSON (`{"number": 42, ...}`), returns `{issueNumber: 42}`, and posts NO close.
  - `syncStory` with an existing `issueNumber` and status `"InReview"` → PATCHes the issue (`gh api repos/{repo}/issues/42 -X PATCH -f state=open`) and posts a transition comment; does NOT create.
  - `syncStory` with an existing `issueNumber` and status `"Done"` → PATCHes `state=closed` AND posts the verified comment (`gh api repos/{repo}/issues/42/comments -f body=…`).
  - A `gh` call that returns `exitCode !== 0` → `syncStory` throws (so the store layer can `reportError`).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.** Compose `gh api` argument arrays (NOT shell strings — the runner takes `string[]`). Create: `["api", \`repos/${repo}/issues\`, "-f", \`title=${title}\`, "-f", \`body=${body}\`]`; parse `JSON.parse(stdout).number`. Update state: `["api", \`repos/${repo}/issues/${n}\`, "-X", "PATCH", "-f", \`state=${statusIsClosed(status) ? "closed" : "open"}\`]`. Comment: `["api", \`repos/${repo}/issues/${n}/comments\`, "-f", \`body=${transitionComment(status, verifyCmd)}\`]`. On create, still post the transition comment if status warrants (e.g. Done on first sync → create then close then comment). Throw on any non-zero exit with the stderr. Keep it pure — no Tauri, no store.
- [ ] **Step 4: Run — PASS.** `npx vitest run src/lib/integrations/githubTracker.test.ts && npx tsc --noEmit`
- [ ] **Step 5: Commit** — `feat(tracker): pure GitHub issue sync core (status→issue, verified-on-Done)`

## Task 3: `trackerStore` — persistence, repo detection, wiring the runner

**Files:** Create `src/stores/trackerStore.ts`. Consumes `run_gh` (Tauri), `run_git` (for remote detection), and the Task 2 core.

**Interfaces — Produces:**
```ts
export interface TrackerConfig { enabled: boolean; repo: string; }         // persisted (sans issues) in .cadre/tracker.json
export interface TrackerFile extends TrackerConfig { issues: Record<string, number>; } // key `${epic}.${story}`
export function parseRepoFromRemote(remoteUrl: string): string | null;     // "git@github.com:o/r.git"/"https://github.com/o/r(.git)" → "o/r"
// store:
//   config: TrackerConfig; issues: Record<string,number>; ghReady: boolean|null;
//   load(root): read .cadre/tracker.json (tolerant); if no repo, detect via `git remote get-url origin`
//   setEnabled(root, on); setRepo(root, repo);
//   checkGh(): run `gh auth status` → ghReady
//   syncStory(root, story, status, verifyCmd?): if enabled+repo, call core.syncStory with a run_gh-backed GhRunner, persist the returned issueNumber into issues + .cadre/tracker.json
//   syncAll(root, stories): sequential syncStory over all stories (for initial setup)
```

- [ ] **Step 1: Pure `parseRepoFromRemote` + test.** Handle `git@github.com:owner/repo.git`, `https://github.com/owner/repo.git`, and the no-`.git` variants → `"owner/repo"`; non-GitHub / unparseable → `null`. Unit-test in `trackerStore.test.ts`.
- [ ] **Step 2: The store (Tauri glue, mirror `reposStore.ts`).** `load` reads `${root}/.cadre/tracker.json` via `read_file` (tolerant → defaults `{enabled:false, repo:"", issues:{}}`); if `repo` empty, run `run_gh`? no — `run_git(cwd:root, ["remote","get-url","origin"])`, `parseRepoFromRemote(stdout)`. `syncStory` builds `const gh: GhRunner = (args) => invoke("run_gh", { cwd: root, args }).then(r => ({stdout:r.stdout, stderr:r.stderr, exitCode:r.exit_code}))` (confirm VerificationResult field names), calls the core, persists the issue number. All invokes wrapped → `reportError("github tracker", e)`, never throw past the store. `checkGh` runs `gh auth status` and sets `ghReady`.
- [ ] **Step 3: Persist** `.cadre/tracker.json` via `write_text_file` on every config/issue change (mirror `reposStore.persistRepos`).
- [ ] **Step 4: Verify** `npx tsc --noEmit && npx vitest run` green.
- [ ] **Step 5: Commit** — `feat(tracker): trackerStore — config, repo detection, gh-backed sync`

## Task 4: Hook into the engine write + Settings UI

**Files:** `src/stores/bmadStore.ts` (`setStatus`), `src/cadre/Settings.tsx`.

- [ ] **Step 1: Fire sync from `setStatus`.** In `bmadStore.setStatus`, AFTER the `await invoke("story_set_status", …)` succeeds (only on success, using the captured `root`), fire-and-forget: `useTrackerStore.getState().syncStory(root, {epic, story, title, acceptanceCriteria}, status, verifyCmd).catch(() => {})` — but ONLY read config synchronously and skip entirely if not enabled, to avoid overhead. Get the story title from the board/stories for `(epic,story)`; get `verifyCmd` from the project's frozen verification (the approved `PlanApproval`/`verification[0]` — find where it's available; if not readily here, pass the story title only and let the Done comment use a generic "the frozen verification command passed"). Do NOT await it — the transition must not block on GitHub.
- [ ] **Step 2: Settings section.** In `Settings.tsx`, add a `<Section icon={GitBranch or Github-like lucide} title="GitHub tracker" subtitle="Push engine-verified status to GitHub Issues (one-way).">`: an enable toggle (`setEnabled`), a repo `<Field>` (auto-detected, editable → `setRepo`), a `gh` auth status line (`checkGh` → "gh authed ✓" / "run `gh auth login`"), and a "Sync all stories" button (`syncAll` over the current board). Load the tracker config when the section mounts. Use existing `<Section>`/`<Field>` + `--c-*` tokens.
- [ ] **Step 3: Verify** `npx tsc --noEmit && npx vitest run && npm run build` green.
- [ ] **Step 4: Manual checklist (human):** in a GitHub-backed project, enable the tracker, confirm repo auto-detects; approve+shard a story, dispatch it; on engine Done, confirm the GitHub issue closes with the "Verified — `<cmd>` passed" comment; toggle off → no calls.
- [ ] **Step 5: Commit** — `feat(tracker): push verified status on engine writes + Settings section`

---

## Self-Review

**Spec coverage:** gh transport → Task 1. Status→issue mapping + verified-on-Done → Task 2. Persistence + repo detection + config → Task 3. Engine hook + UI → Task 4. ✓

**Type consistency:** `GhRunner`/`SyncStoryInput`/`TrackerStatus`/`syncStory` (Task 2) consumed by Task 3; `TrackerConfig`/`parseRepoFromRemote` (Task 3) consumed by Task 4. `Status` (engine) maps to `TrackerStatus` (same string union).

**Non-blocking invariant:** Task 4 Step 1 fires sync AFTER the engine write, unawaited, guarded on enabled, all errors → `reportError`. A GitHub outage cannot break the disciplined loop.

**Security:** no token anywhere — `gh` owns auth (Task 1 Step 1, Global Constraints). Disabled by default (Task 3 defaults).

**Placeholder scan:** exact files, `gh api` argument arrays, and test cases named. Verify `VerificationResult` field names (`exit_code`/`stdout`/`stderr`) when wiring the runner in Task 3.
