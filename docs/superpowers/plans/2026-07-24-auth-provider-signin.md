# Auth: Provider Sign-In (Phase 1 — one provider, one credential)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Sign in once with a provider (Claude login, Anthropic key, DeepSeek key, or Kimi key) and have that one credential drive BOTH planning and dispatch — no requirement to paste an Anthropic key if you use DeepSeek/Kimi, and no key at all for Claude *dispatch* (login). (Phase 2, separate plan, makes Claude-login planning key-free via the CLI.)

**Architecture:** An `authProvider` setting selects the active provider. Planning is unified onto it: `planningTurn` gains a `baseUrl` and creates its `@anthropic-ai/sdk` client with `{ apiKey, baseURL }`, so a key-based provider (Anthropic / DeepSeek / Kimi — all expose Anthropic-compatible endpoints) powers planning too. A Sign-In screen picks the provider + credential and defaults the fleet to it. Existing plumbing reused: `PROVIDERS` (with `secretKey` + `baseUrl`), `resolveAgentEnv` (dispatch env), `dispatchUseLogin` (Claude CLI login for dispatch), the OS keychain (`secretGet/Set`).

**Tech Stack:** Tauri v2 (Rust), React 19 + TS, Zustand, `@anthropic-ai/sdk`, Vitest.

## Global Constraints

- Preserve all frontend tests (`npx vitest run` — 155 on this branch's base) + Rust (`cargo test`) green after every task.
- Backward compat: a user with only an Anthropic key and default settings behaves EXACTLY as today (authProvider defaults to `"claude"`, planning uses the Anthropic key with no baseUrl).
- Never store keys in plaintext/localStorage — keys stay in the OS keychain (`secretGet/secretSet`), as today. `authProvider` (a non-secret id) may persist in settings.
- Errors surface via `reportError` (merged to main) — any new failure path uses it.
- Phase 1 does NOT make Claude-*login* planning key-free (that's Phase 2). For a Claude-login user, planning still needs an Anthropic key; the UI must say so clearly, not fail silently.

---

## File Structure

- `src/lib/planning/planningAuth.ts` *(new)* — pure `resolvePlanningAuth(...)` mapping the selected provider → `{ apiKey, baseUrl, ready, reason }`. Unit-tested (secret getter injected).
- `src/lib/planning/planningChat.ts` — `planningTurn`/other turn fns accept `baseUrl?` and pass it to `new Anthropic({ apiKey, baseURL })`.
- `src/stores/settingsStore.ts` — `authProvider: string` + `setAuthProvider`; persisted.
- `src/cadre/useCadre.ts` — planning call sites resolve auth via the selected provider (not raw `anthropicApiKey`).
- `src/cadre/PlanningStudio.tsx`, `src/cadre/OrchestratorChat.tsx` — pass the resolved `{apiKey, baseUrl}` into `planningTurn`; show a clear "planning needs a key for Claude-login" notice.
- `src/cadre/SignIn.tsx` *(new)* — the sign-in screen (provider picker + credential).
- `src/cadre/Welcome.tsx` / `CadreApp.tsx` — surface Sign-In as the primary onboarding when unauthenticated.
- `src-tauri/src/lib.rs` *(optional, Task 6)* — `claude_auth_status` command to detect a Claude CLI login.

---

## Task 1: `authProvider` setting + `resolvePlanningAuth` (pure)

**Files:** Modify `src/stores/settingsStore.ts`; Create `src/lib/planning/planningAuth.ts` + `planningAuth.test.ts`.

**Interfaces — Produces:**
```ts
// settingsStore
authProvider: string;                 // provider id; default "claude"
setAuthProvider: (id: string) => void; // persists

// planningAuth.ts
export interface PlanningAuth { apiKey: string; baseUrl?: string; ready: boolean; reason?: string }
// Resolve the credential planning should use for `providerId`.
// - key-based provider: { apiKey: <secret>, baseUrl: provider.baseUrl, ready: !!apiKey, reason? }
// - claude + useLogin (no key): { apiKey: "", ready: false, reason: "Claude login can't power planning yet — add an Anthropic key or use another provider." }
export async function resolvePlanningAuth(
  providerId: string,
  useLogin: boolean,
  getSecret: (key: string) => Promise<string | null>,
): Promise<PlanningAuth>;
```

- [ ] **Step 1: Failing test** (`planningAuth.test.ts`) — inject a fake `getSecret`:
```ts
import { describe, it, expect } from "vitest";
import { resolvePlanningAuth } from "./planningAuth";

const secrets = (m: Record<string,string>) => async (k: string) => m[k] ?? null;

describe("resolvePlanningAuth", () => {
  it("anthropic key → ready, no baseUrl", async () => {
    const a = await resolvePlanningAuth("claude", false, secrets({ anthropic_api_key: "sk-ant" }));
    expect(a).toMatchObject({ apiKey: "sk-ant", ready: true });
    expect(a.baseUrl).toBeUndefined();
  });
  it("kimi key → ready with moonshot baseUrl", async () => {
    const a = await resolvePlanningAuth("kimi", false, secrets({ moonshot_api_key: "sk-m" }));
    expect(a).toMatchObject({ apiKey: "sk-m", baseUrl: "https://api.moonshot.ai/anthropic", ready: true });
  });
  it("missing key → not ready with a reason", async () => {
    const a = await resolvePlanningAuth("deepseek", false, secrets({}));
    expect(a.ready).toBe(false);
    expect(a.reason).toBeTruthy();
  });
  it("claude + login (no key) → not ready, explains Phase-2 gap", async () => {
    const a = await resolvePlanningAuth("claude", true, secrets({}));
    expect(a.ready).toBe(false);
    expect(a.reason).toMatch(/login/i);
  });
});
```
- [ ] **Step 2: Run — FAIL.** `npx vitest run src/lib/planning/planningAuth.test.ts`
- [ ] **Step 3: Implement `planningAuth.ts`** using `getProvider(providerId)` from `../engine/providers` (has `secretKey` + `baseUrl`):
```ts
import { getProvider } from "../engine/providers";
export interface PlanningAuth { apiKey: string; baseUrl?: string; ready: boolean; reason?: string }
export async function resolvePlanningAuth(providerId: string, useLogin: boolean, getSecret: (k: string) => Promise<string | null>): Promise<PlanningAuth> {
  const provider = getProvider(providerId);
  if (providerId === "claude" && useLogin) {
    return { apiKey: "", ready: false, reason: "Claude login can't power planning yet — add an Anthropic key or pick another provider for planning." };
  }
  const apiKey = (await getSecret(provider.secretKey))?.trim() ?? "";
  if (!apiKey) return { apiKey: "", baseUrl: provider.baseUrl, ready: false, reason: `Add a ${provider.name} API key to enable planning.` };
  return { apiKey, baseUrl: provider.baseUrl, ready: true };
}
```
- [ ] **Step 4: Add `authProvider` to settingsStore** — field default `"claude"`, `setAuthProvider` (persist via the existing `persistSettings`), mirror the pattern of `dispatchUseLogin`. Add to the `Settings` interface, defaults, setter interface + impl.
- [ ] **Step 5: Run — PASS** (planningAuth tests + full suite). `npx tsc --noEmit && npx vitest run`
- [ ] **Step 6: Commit** — `git commit -am "feat(auth): authProvider setting + resolvePlanningAuth (provider-based planning credential)"`

## Task 2: `planningTurn` accepts a `baseUrl`

**Files:** Modify `src/lib/planning/planningChat.ts` (+ any sibling turn fn that builds an `Anthropic` client). Test: extend `planningChat` tests if present; otherwise a focused new test.

**Interfaces:** every turn fn opts type gains `baseUrl?: string`; the `new Anthropic({ apiKey })` call becomes `new Anthropic({ apiKey, ...(baseUrl ? { baseURL: baseUrl } : {}) })`.

- [ ] **Step 1: Grep the client sites** — `grep -n "new Anthropic" src/lib/planning/*.ts`. There may be more than one turn fn (e.g. `planningTurn`, a titling/util turn). Each that creates a client + takes `apiKey` gets `baseUrl?`.
- [ ] **Step 2: Add `baseUrl?: string`** to each opts interface and thread it into the client constructor. Do NOT change any other behavior (streaming, tools, fallbackModel).
- [ ] **Step 3: Test** — if there's an existing planningChat test that mocks the SDK, add an assertion that passing `baseUrl` sets the client `baseURL`. If the SDK isn't easily mockable, add a thin unit test around a small extracted `makeClient({apiKey, baseUrl})` helper and assert it forwards `baseURL`. Keep it real, not vacuous.
- [ ] **Step 4: `npx tsc --noEmit && npx vitest run`** — green.
- [ ] **Step 5: Commit** — `git commit -am "feat(planning): planningTurn accepts a provider baseUrl"`

## Task 3: Route planning callers through the selected provider

**Files:** Modify `src/cadre/useCadre.ts`, `src/cadre/PlanningStudio.tsx`, `src/cadre/OrchestratorChat.tsx`.

**Interfaces:** a small hook/util `usePlanningAuth()` (or inline) that reads `authProvider` + `dispatchUseLogin` from settings and calls `resolvePlanningAuth(..., secretGet)`; callers pass `{ apiKey: auth.apiKey, baseUrl: auth.baseUrl }` into `planningTurn` and gate the send on `auth.ready` (showing `auth.reason` when not ready).

- [ ] **Step 1** — In `useCadre.ts`, every planning call currently uses `requireKey()`/`anthropicApiKey`. Replace with the resolved provider auth: resolve once at the call, pass `apiKey`+`baseUrl`. Where a call is gated on "has key," gate on `auth.ready` and `reportError`/toast the `reason` if not.
- [ ] **Step 2** — `PlanningStudio.tsx` and `OrchestratorChat.tsx`: replace the `apiKey = useSettingsStore(s => s.anthropicApiKey)` gate with the resolved provider auth; pass `baseUrl` into `planningTurn`; when `!auth.ready`, disable send and show `auth.reason` (this is where a Claude-login user is told planning needs a key).
- [ ] **Step 3: `npx tsc --noEmit && npx vitest run`** — green (155). Manually reason: default (authProvider "claude", anthropic key present) → identical to today.
- [ ] **Step 4: Commit** — `git commit -am "feat(planning): planning runs on the selected auth provider (key + baseUrl)"`

## Task 4: Sign-In screen + provider drives the fleet default

**Files:** Create `src/cadre/SignIn.tsx`; modify `src/cadre/Welcome.tsx`/`CadreApp.tsx`; touch `useCadre`/`settingsStore` for the fleet default.

- [ ] **Step 1: `SignIn.tsx`** — a card: pick provider (Claude / Anthropic / DeepSeek / Kimi). For Claude, a toggle "Use my Claude login (Max/Pro) for dispatch" (sets `dispatchUseLogin`) plus an optional Anthropic key field (for planning, with the Phase-2 note). For Anthropic/DeepSeek/Kimi, a single key field (stored via `secretSet(provider.secretKey, ...)`). A "Continue" that sets `authProvider` and, by default, `fleetProvider = authProvider`. Reuse the token styles + `KeyField` pattern from `Settings.tsx`.
- [ ] **Step 2: Onboarding** — when no usable credential exists (no key for the selected provider AND not Claude-login), show Sign-In (from `Welcome`/`CadreApp`). Keep Settings' key fields too (Sign-In and Settings share the same keychain).
- [ ] **Step 3: Fleet default** — when `authProvider` is set, default `fleetProvider` to it (don't override an explicit user choice; just default). Confirm `resolveFleetAuth` already routes login vs key correctly (it does).
- [ ] **Step 4: `npx tsc --noEmit && npx vitest run && npm run build`** — green.
- [ ] **Step 5: Manual checklist (for the human)** — (a) sign in with a DeepSeek/Kimi key only (no Anthropic key) → planning AND dispatch both work on that one key; (b) sign in with Claude login → dispatch works with no key, planning shows the "needs a key" notice; (c) existing Anthropic-key user → unchanged.
- [ ] **Step 6: Commit** — `git commit -am "feat(auth): Sign-In screen; selected provider drives planning + fleet"`

## Task 5 (optional): Claude login status probe

**Files:** `src-tauri/src/lib.rs` (+ registration); `SignIn.tsx`.

- [ ] **Step 1** — Rust command `claude_auth_status() -> Result<bool, String>` that returns whether the `claude` CLI has a login (check the CLI's creds location / run a fast non-interactive auth check with a short timeout). Best-effort; on any error return `false`.
- [ ] **Step 2** — In Sign-In's Claude-login option, a "Check login" button that calls it and shows ✓ logged in / "run `claude login` in a terminal". Non-blocking.
- [ ] **Step 3** — `cargo test` unaffected; `tsc`/`vitest`/`build` green. Commit.

---

## Self-Review

**Spec coverage:** one-provider-one-credential → Task 1 (authProvider+resolve) + Task 3 (planning routes to it) + Task 4 (sign-in + fleet default). DeepSeek/Kimi fully key-based → Tasks 1–4. Claude login dispatch key-free → existing `dispatchUseLogin`, surfaced in Task 4. Honest Phase-2 gap for Claude-login planning → `resolvePlanningAuth` reason + Task 3/4 UI notice. ✓

**Backward-compat:** `authProvider` defaults `"claude"`, `resolvePlanningAuth("claude", false, ...)` → the Anthropic key with no baseUrl → identical to today. Planning callers pass `baseUrl: undefined` for Anthropic → unchanged SDK behavior. ✓

**Type consistency:** `PlanningAuth {apiKey, baseUrl?, ready, reason?}`, `resolvePlanningAuth(providerId, useLogin, getSecret)`, `authProvider`/`setAuthProvider`, `baseUrl?` on the turn opts — used identically across tasks. Provider `secretKey`/`baseUrl` come from the existing `PROVIDERS`.

**Placeholder scan:** none — code shown for the pure/core pieces; UI tasks name exact files/fields and are gated by build + the manual checklist.

**Phase 2 (separate plan, later):** route planning/orchestrator through the `claude` CLI so Claude-login users need no key — makes `resolvePlanningAuth("claude", true)` `ready` via a CLI transport instead of the SDK.
