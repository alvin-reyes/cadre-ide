# Cadre — Manual E2E Test Script

The automated suite (`src/lib/engine/e2e.test.ts` + 124 TS + 27 Rust) proves the
engine's disciplined loop with fakes. This script covers what only a human can
run: the **live LLM planning conversation** and the **real `claude` dispatch**
behind the GUI. Run it in `npm run tauri dev`.

## Prerequisites
- A throwaway git project with at least one commit (dispatch does `git worktree add … HEAD`):
  ```bash
  mkdir -p /tmp/cadre-test && cd /tmp/cadre-test && git init -q && git commit -q --allow-empty -m init
  ```
- `claude` CLI on PATH (dispatch runs `claude -p`).
- A fresh Anthropic API key (`sk-ant-…`).

## Run
```bash
cd <repo> && npm run tauri dev
```

---

## 1. First run + key (keychain)
- [ ] Welcome screen shows the serif `cadre` wordmark + "Verified, not vibed."
- [ ] Open `/tmp/cadre-test`.
- [ ] Paste the API key in the Planning Studio key banner → Save.
- [ ] **Restart the app**, reopen the project → the key is remembered (loaded from the OS keychain, not localStorage).

## 2. PM-first + hand-off gating
- [ ] Only the **PM** tab is active; **Architect / Design / PO** show a lock icon and are not clickable.
- [ ] Talk to the PM (e.g. "a task tracker for small teams"). Reply **streams** token-by-token with a blinking caret; a "the PM is thinking" loader shows first.
- [ ] The **doc pane** shows a "drafting" indicator, then `docs/prd.md` fills in with serif headings.
- [ ] **Quick-reply chips** appear under the composer; clicking one sends it.
- [ ] You can **type while it's responding** (composer never locks).
- [ ] Ask the PM to move on ("looks good, let's design it"). The PM **hands off** → the Architect tab **unlocks**. You could not reach it before.

## 3. Architect + suggested verify command
- [ ] Switch to the Architect (now unlocked). Talk through the stack.
- [ ] `docs/architecture.md` forms in the doc pane.
- [ ] The bottom bar flips to the green **Approve** bar with the verify command **pre-filled** and marked "Architect's suggestion".

## 4. Design (optional) — live mockup
- [ ] From the PM, hand off to Design (or use the tab if unlocked).
- [ ] Describe a screen. `docs/ux-spec.md` forms, and the **Preview** toggle shows a **rendered HTML mockup** in a sandboxed frame. Toggle Spec/Preview.

## 5. Approve → Fleet
- [ ] Set the verify command to `true` for a first smoke test (guaranteed green).
- [ ] Click **Approve plan**. It writes `docs/prd.md` + `docs/architecture.md` (+ ux-spec/mockup if present), freezes `true`, and jumps to **FLEET**.

## 6. Shard + dispatch + live output (the thesis)
- [ ] Click **Generate story (SM)** → a Draft card appears (`docs/stories/1.1.*.md` written).
- [ ] Select it → the pane shows the **real story** (Story/Output toggle).
- [ ] Click **Dispatch** → the **Output** tab streams the real `claude` run live; then Cadre runs `true` (you see `$ true` + `[verification exit 0]`) and the card flips to **Done**.
- [ ] Re-run with a real command (`npm test` in a project that has one): a passing suite → **Done**; a failing suite → **Failed** (with the real output).

## 7. Multi-model (optional)
- [ ] In the Fleet toolbar, switch the model picker to Kimi/DeepSeek → it prompts for that provider's key (stored in the keychain). Claude stays keyless if the Anthropic key is set.

## 8. Scope change → automatic cascade → re-approval
- [ ] On the board, click **New requirement** → returns to the PM.
- [ ] Add a requirement ("also add CSV export"). The PM **amends the existing PRD** (doesn't start over).
- [ ] The bottom bar shows **"Scope changed"**; the Fleet board shows the same banner and **Dispatch is disabled**.
- [ ] Click **Apply changes** → the Architect auto-updates `architecture.md`, the Designer updates the UX (if present), and a **new story** is sharded — no manual walk.
- [ ] Click **Re-approve** → dispatch un-pauses; dispatch the new story.

## 9. Reload-from-git
- [ ] Quit and reopen the project → the board, plan docs, frozen verify command, and phase all restore from disk. If it was approved, you land on FLEET.

---

## What to report on failure
The exact error text (banner or chat bubble) + which step. Likely first snags:
model id, a Tauri arg mismatch (camelCase vs snake_case), the `claude` invocation,
or CORS on the SDK. Each is a quick fix.
