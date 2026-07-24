# Merge Auto-Resolver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** When a verified story's merge-back conflicts, dispatch a resolver agent to fix the conflict against the Context Store and re-verify — integrating only if the engine's verification passes — instead of always handing the conflict to the human.

**Architecture:** On a merge conflict, work on a throwaway `resolve/{epic}.{story}` branch + worktree off `main` (main is never touched until a resolution is proven). Merge the story branch there leaving conflict markers, dispatch a resolver agent (`claude -p`) to resolve + commit, then the ENGINE re-runs the frozen verification command. Green ⇒ fast-forward `main` to the resolution (Done). Any failure (unresolved markers, agent crash, verify red) ⇒ discard the temp branch and fall back to `Blocked` — exactly today's behavior. The agent proposes; the engine decides. All within the existing serialized merge lock. Gated by an `autoResolveMerge` setting (default on).

**Tech Stack:** Tauri v2 (Rust engine reused as-is), React + TS, Zustand, Vitest.

## Global Constraints

- Preserve all frontend tests (`npx vitest run` — 155 on main's base) + Rust (`cargo test`) green after every task.
- **`main` never sees an unverified resolution.** Resolution happens on a temp branch/worktree; only a clean + verified result is fast-forwarded into `main`.
- **Engine-owned verification is preserved:** the resolver agent never writes `Done`. The engine runs the frozen verify command (the same `PlanApproval.verification`) and decides. A resolved-but-failing merge → `Blocked`.
- **Strictly an improvement:** if `autoResolveMerge` is off, or the resolver fails at any step, behavior is identical to today (conflict → `Blocked`, main untouched).
- Bounded: ONE resolution attempt per integration; the resolver agent is killed at the existing agent timeout.
- Errors surface via `reportError` (already on main). Journaled via `logSession`.
- Multi-repo note: this builds on main's single-repo `integrateStory({root,...})`. When `feat/multi-repo-dispatch` merges, thread `repoPath` into the resolver the same way (reconcile at merge time).

---

## File Structure

- `src/lib/engine/resolveConflict.ts` *(new)* — pure `composeResolverPrompt(...)` + the DI orchestration `resolveMergeConflict(deps, input)`. Fully dependency-injected (like `runStory.ts`), unit-tested with fakes.
- `src/lib/engine/resolveConflict.test.ts` *(new)* — happy path (conflict→resolve→verify→integrate) + every fallback (unresolved, agent non-zero, verify red) via fake deps.
- `src/lib/engine/tauriDeps.ts` — a `tauriResolveConflictDeps(onOutput?)` factory (reuses spawnAgent/waitForExit/runGit/runVerification/killAgent).
- `src/stores/settingsStore.ts` — `autoResolveMerge: boolean` (default true) + setter.
- `src/cadre/Settings.tsx` — a toggle.
- `src/cadre/useCadre.ts` — on `integ.conflict`, if `autoResolveMerge`, run `resolveMergeConflict`; on success integrate/Done, else Blocked. Journaled.

---

## Task 1: `resolveConflict.ts` — pure prompt + DI orchestration

**Files:** Create `src/lib/engine/resolveConflict.ts` + `resolveConflict.test.ts`.

**Interfaces — Produces:**
```ts
import type { AlwaysFile } from "./dispatch";

export function resolverBranch(epic: number, story: number): string; // `resolve/${epic}.${story}`
export function resolverWorktreePath(root: string, epic: number, story: number): string; // `${root}/.cadre/worktrees/resolve-${epic}.${story}`

// The prompt handed to the resolver agent: persona + Context Store + story + the
// resolve-and-commit directive. Pure/testable.
export function composeResolverPrompt(input: {
  storyMarkdown: string;
  alwaysFiles: AlwaysFile[];   // the Context Store (shared contracts)
  epic: number; story: number;
}): string;

export interface ResolveDeps {
  runGit: (args: string[], cwd: string) => Promise<void>;
  /** like runGit but returns stdout + exit code without throwing (for `diff --check` / unmerged-file probes) */
  runGitQuery: (args: string[], cwd: string) => Promise<{ exitCode: number | null; stdout: string }>;
  spawnAgent: (opts: { command: string; args: string[]; cwd: string; env?: Record<string, string> }) => Promise<number>;
  waitForExit: (ptyId: number) => Promise<{ exitCode: number | null }>;
  killAgent?: (ptyId: number) => Promise<void>;
  runVerification: (cwd: string, command: string, timeoutSecs: number) => Promise<{ exitCode: number | null; timedOut: boolean }>;
}

export interface ResolveInput {
  root: string;
  epic: number;
  story: number;
  storyBranch: string;      // the story's branch to merge in
  prompt: string;           // composeResolverPrompt output
  commands: string[];       // the frozen verification steps
  timeoutSecs: number;      // verification timeout
  agentTimeoutSecs?: number;// resolver-agent kill timeout
  model?: string;
  env?: Record<string, string>;
}

export interface ResolveResult {
  resolved: boolean;        // true only if merged clean AND verification passed AND fast-forwarded into main
  reason?: string;          // why it failed (for the log): "unresolved" | "agent-failed" | "verify-failed" | "integrate-failed"
}

export async function resolveMergeConflict(deps: ResolveDeps, input: ResolveInput): Promise<ResolveResult>;
```

**Orchestration (implement in this order):**
1. Idempotent cleanup: `worktree remove --force <rw>`, `worktree prune`, `branch -D <resolveBranch>` (each tolerant/try).
2. `worktree add -b <resolveBranch> <rw> HEAD` in `root` (branch off current main).
3. In `<rw>`: attempt `merge --no-ff <storyBranch>` — expect it to leave conflicts. Use `runGitQuery` (non-throwing) so a non-zero merge is fine; do NOT abort.
4. Spawn the resolver agent (`claude --dangerously-skip-permissions -p <prompt>` + `--model` if set), cwd `<rw>`, env `input.env`. Wait for exit with the agent timeout (mirror `runStory`'s race+kill). If exit code ≠ 0 or timed out → `cleanup(); return { resolved:false, reason:"agent-failed" }`.
5. Check resolution: `runGitQuery(["diff","--name-only","--diff-filter=U"], rw)` — if stdout non-empty → unmerged paths remain → `cleanup(); return {resolved:false, reason:"unresolved"}`. If the agent didn't commit (working tree dirty / MERGE_HEAD present), commit it: `git add -A` then `[IDENT] commit --no-edit` (or `-m "cadre: resolve merge for {e}.{s}"`). Use a fixed IDENT like integrate.ts.
6. Re-verify: run each `input.commands` step via `runVerification(rw, cmd, timeoutSecs)`; first failure/timeout → `cleanup(); return {resolved:false, reason:"verify-failed"}`.
7. Integrate: in `root`, `merge --ff-only <resolveBranch>` (main hasn't moved — caller holds the merge lock). If it throws → `cleanup(); return {resolved:false, reason:"integrate-failed"}`.
8. `cleanup()` (remove worktree, prune, delete resolveBranch) and `return { resolved:true }`.

Where `cleanup()` = tolerant `worktree remove --force <rw>` + `worktree prune` + `branch -D <resolveBranch>`.

- [ ] **Step 1: Write failing tests** (`resolveConflict.test.ts`) with fake deps that record git calls and script outcomes:

```ts
import { describe, it, expect } from "vitest";
import { composeResolverPrompt, resolveMergeConflict, resolverBranch, resolverWorktreePath } from "./resolveConflict";

function fakeDeps(script: {
  unmergedAfterAgent?: string;   // stdout of the diff --filter=U probe (empty = resolved)
  agentExit?: number | null;
  verifyExit?: number | null;
  ffThrows?: boolean;
}) {
  const git: string[][] = [];
  const deps = {
    runGit: async (args: string[]) => {
      git.push(args);
      if (script.ffThrows && args.includes("--ff-only")) throw new Error("not fast-forward");
    },
    runGitQuery: async (args: string[]) => {
      git.push(args);
      if (args.includes("--diff-filter=U")) return { exitCode: 0, stdout: script.unmergedAfterAgent ?? "" };
      return { exitCode: 0, stdout: "" }; // merge leaves conflict, non-throwing
    },
    spawnAgent: async () => 1,
    waitForExit: async () => ({ exitCode: script.agentExit ?? 0 }),
    runVerification: async () => ({ exitCode: script.verifyExit ?? 0, timedOut: false }),
  };
  return { deps, git };
}

const base = { root: "/proj", epic: 1, story: 2, storyBranch: "story/1.2", prompt: "P", commands: ["npm test"], timeoutSecs: 60 };

describe("resolveMergeConflict", () => {
  it("resolves, verifies, and fast-forwards into main → resolved:true", async () => {
    const { deps, git } = fakeDeps({ unmergedAfterAgent: "", agentExit: 0, verifyExit: 0 });
    const r = await resolveMergeConflict(deps, base);
    expect(r.resolved).toBe(true);
    // worktree created off HEAD, merged story branch, then ff-only into main
    expect(git.some((a) => a[0] === "worktree" && a[1] === "add")).toBe(true);
    expect(git.some((a) => a.includes("--ff-only") && a.includes(resolverBranch(1,2)))).toBe(true);
  });
  it("unresolved markers remain → resolved:false reason unresolved, no ff-only", async () => {
    const { deps, git } = fakeDeps({ unmergedAfterAgent: "src/a.ts\n", agentExit: 0, verifyExit: 0 });
    const r = await resolveMergeConflict(deps, base);
    expect(r).toEqual({ resolved: false, reason: "unresolved" });
    expect(git.some((a) => a.includes("--ff-only"))).toBe(false);
  });
  it("agent non-zero exit → resolved:false reason agent-failed", async () => {
    const { deps } = fakeDeps({ agentExit: 1 });
    expect(await resolveMergeConflict(deps, base)).toEqual({ resolved: false, reason: "agent-failed" });
  });
  it("verification red after resolution → resolved:false reason verify-failed, main untouched", async () => {
    const { deps, git } = fakeDeps({ unmergedAfterAgent: "", agentExit: 0, verifyExit: 1 });
    const r = await resolveMergeConflict(deps, base);
    expect(r).toEqual({ resolved: false, reason: "verify-failed" });
    expect(git.some((a) => a.includes("--ff-only"))).toBe(false);
  });
  it("composeResolverPrompt includes the story, context files, and a resolve+commit directive", () => {
    const p = composeResolverPrompt({ storyMarkdown: "# Story 1.2", alwaysFiles: [{ path: ".cadre/context/api.md", content: "contract" }], epic: 1, story: 2 });
    expect(p).toContain("# Story 1.2");
    expect(p).toContain("contract");
    expect(p).toMatch(/conflict/i);
    expect(p).toMatch(/commit/i);
  });
  it("path helpers", () => {
    expect(resolverBranch(1,2)).toBe("resolve/1.2");
    expect(resolverWorktreePath("/proj",1,2)).toBe("/proj/.cadre/worktrees/resolve-1.2");
  });
});
```

- [ ] **Step 2: Run — FAIL.** `npx vitest run src/lib/engine/resolveConflict.test.ts`
- [ ] **Step 3: Implement `resolveConflict.ts`** per the orchestration above. `composeResolverPrompt`: a SYSTEM-style preamble ("You are resolving a git merge conflict for story {e}.{s}. Resolve every conflict preserving BOTH sides' intent; honor the shared contracts below; do NOT delete working code to make it merge. When done, ensure there are no conflict markers, then `git add -A` and commit."), then the Context Store files, then the story. Model the agent-timeout race on `runStory.ts`. Use a fixed IDENT for the commit.
- [ ] **Step 4: Run — PASS.** `npx vitest run src/lib/engine/resolveConflict.test.ts && npx tsc --noEmit`
- [ ] **Step 5: Commit** — `git commit -am "feat(engine): merge conflict auto-resolver (DI orchestration + prompt)"`

## Task 2: Tauri deps + `autoResolveMerge` setting + toggle

**Files:** `src/lib/engine/tauriDeps.ts`, `src/stores/settingsStore.ts`, `src/cadre/Settings.tsx`.

**Interfaces:**
- `tauriResolveConflictDeps(onOutput?: OutputSink): ResolveDeps` — reuse `makeSpawnAgent`, `waitForExit`, `makeRunVerification`, `runGit`; add `runGitQuery` = call `run_git` and return `{exitCode: res.exit_code, stdout: res.stdout}` (the Rust `run_git` already returns stdout/exit — do NOT throw on non-zero). `killAgent` = `invoke("kill_pty",{id})`.
- `settingsStore`: `autoResolveMerge: boolean` (default `true`) + `setAutoResolveMerge` (mirror `gateOnReview`; persisted).

- [ ] **Step 1** — add `runGitQuery` to tauriDeps (a non-throwing `run_git` wrapper) and the `tauriResolveConflictDeps` factory. (`run_git` returns `RustRunResult{exit_code,stdout,stderr}` — `runGit` throws on non-zero; `runGitQuery` returns it.)
- [ ] **Step 2** — add `autoResolveMerge` to `settingsStore` (interface + default `true` + setter + interface entry), mirroring `gateOnReview` exactly.
- [ ] **Step 3** — `Settings.tsx`: a checkbox "Auto-resolve merge conflicts" with subtext "On a merge conflict, an agent resolves it and the engine re-verifies before integrating. If it can't, the story is Blocked (as before)." Mirror the `gateOnReview` toggle.
- [ ] **Step 4** — `npx tsc --noEmit && npx vitest run` green.
- [ ] **Step 5: Commit** — `git commit -am "feat(engine): resolve-conflict tauri deps; autoResolveMerge setting + toggle"`

## Task 3: Wire the resolver into `dispatchStory`'s conflict path

**Files:** `src/cadre/useCadre.ts`.

**Interfaces:** In `dispatchStory`, where `integrateStory` returns `integ.conflict`, insert the resolver before Blocking.

- [ ] **Step 1** — replace the conflict branch:
```ts
if (integ.conflict) {
  const doResolve = useSettingsStore.getState().autoResolveMerge;
  let resolved = false;
  if (doResolve) {
    onOutput(`\n[cadre] merge conflict on ${epic}.${story} — attempting auto-resolution\n`);
    const context = await loadSharedContext(root);            // Context Store (already used at dispatch)
    const prompt = composeResolverPrompt({ storyMarkdown, alwaysFiles: context, epic, story });
    const provider = getProvider(get().fleetProvider);
    const { env, model } = await resolveFleetAuth(provider);
    const res = await withMergeLock(() => resolveMergeConflict(
      { ...tauriResolveConflictDeps(onOutput) },
      { root, epic, story, storyBranch: storyBranch(epic, story), prompt,
        commands: /* the frozen verification */ (await getPlanApproval())?.verification ?? [],
        timeoutSecs: 1800, agentTimeoutSecs: agentTimeoutSecs(), model, env }
    ));
    resolved = res.resolved;
    await logSession(root, resolved
      ? `auto-resolved merge conflict for story ${named} and integrated`
      : `auto-resolve failed for story ${named} (${res.reason}) — Blocked`);
  }
  if (resolved) {
    onOutput(`\n[cadre] auto-resolved & integrated ${epic}.${story}\n`);
    toast(`Story ${epic}.${story}: conflict auto-resolved & integrated`, "success");
  } else {
    await useBmadStore.getState().setStatus(epic, story, "Blocked");
    onOutput(`\n[cadre] ${epic}.${story} Blocked — resolve the conflict manually\n`);
    toast(`Story ${epic}.${story}: merge conflict — Blocked`, "error");
  }
}
```
(Get `storyMarkdown` — it's already read at the top of `dispatchStory`. `storyBranch`/`getProvider`/`resolveFleetAuth`/`agentTimeoutSecs`/`loadSharedContext`/`withMergeLock` are all already imported/in-scope. `getPlanApproval` frozen verification: use whatever `runApprovedStory` uses — grep how the verify commands are obtained; reuse that source, do NOT let the caller forge them.)

- [ ] **Step 2** — imports: `resolveMergeConflict`, `composeResolverPrompt` from `../lib/engine/resolveConflict`; `tauriResolveConflictDeps` from `../lib/engine/tauriDeps`; `storyBranch` from `../lib/engine/dispatch` (if not already).
- [ ] **Step 3** — `npx tsc --noEmit && npx vitest run` green (no store unit tests; behavior guarded by Task 1's DI tests + tsc).
- [ ] **Step 4** — manual checklist (for the human): create two stories that edit the SAME file in conflicting ways; dispatch both; on the second's merge, confirm the log shows "attempting auto-resolution", the resolver commits, the engine re-verifies, and it integrates when green. Force an unresolvable conflict (e.g. verify that fails post-merge) → confirm it falls back to Blocked with main clean. Toggle the setting off → confirm immediate Blocked (today's behavior).
- [ ] **Step 5: Commit** — `git commit -am "feat(fleet): auto-resolve merge conflicts before Blocking"`

---

## Self-Review

**Spec coverage:** conflict → resolver agent → re-verify → integrate-or-Block → Task 1 (orchestration) + Task 3 (wiring). Context Store injected → Task 1 prompt + Task 3 `loadSharedContext`. Engine re-verifies (agent never self-reports) → Task 1 step 6 uses the frozen `commands`. main untouched until proven → Task 1 works on the temp branch, ff-only last. Setting default-on + fallback identical to today → Task 2 + Task 3. Bounded + timeout → Task 1 agent race. ✓

**Type consistency:** `ResolveDeps`/`ResolveInput`/`ResolveResult`, `resolveMergeConflict`, `composeResolverPrompt`, `resolverBranch`/`resolverWorktreePath`, `runGitQuery`, `autoResolveMerge` used identically across tasks.

**Known limitation (documented):** single attempt (no iterative re-resolve loop); a resolution that passes verify but is semantically wrong is possible — but no more so than any agent work, and the engine's verification is the same gate every story passes. Multi-repo `repoPath` threading reconciled when that branch merges.

**Placeholder scan:** none — Task 1 is fully coded/tested; Tasks 2–3 name exact files, the frozen-verify source is called out to be reused (not forged), and the wiring code is shown.
