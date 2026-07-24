# Orchestrator Copilot v2 (Tool-Calling Controller) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn the floating Orchestrator from an advisor into a controller — its chat can shard, approve, and dispatch work via tool-calling, executing real project actions (each shown inline) instead of only describing them.

**Architecture:** A fixed allowlist of tools maps to existing, vetted `useCadre` actions. A bounded agentic loop (`orchestratorTurn`) streams assistant text and, when the model emits a `tool_use`, runs the mapped action via a pure dispatcher, feeds the result back, and continues until the model stops. The model can only call these typed actions with validated args — never arbitrary code — and the engine still owns verification/status. `approve_plan` (freezing the verification command) is NOT exposed — it stays a human decision.

**Tech Stack:** React 19 + TS, Zustand, `@anthropic-ai/sdk` (streaming + tools), Vitest.

## Global Constraints

- Preserve all 196 frontend tests + Rust green after every task.
- The tool loop is BOUNDED (max 8 iterations) — no runaway agent.
- Only the allowlisted actions are callable; `approve_plan` is excluded. Args are validated before the action runs; a bad arg returns a tool error, never a throw that kills the loop.
- Planning credential is the already-resolved provider auth (this branch is on main, which has auth Phase 1): the Orchestrator already resolves `{apiKey, baseUrl}` via the `planAuth` path — reuse it; do NOT hardcode the Anthropic key.
- Every executed action is journaled (`logSession`) and errors surface via `reportError`.
- Backward-compat: if the model calls no tools, behavior is the same streamed chat as today.

---

## File Structure

- `src/lib/planning/orchestratorTools.ts` *(new)* — the tool JSON schemas + `OrchestratorActions` interface + pure `runOrchestratorTool(name, input, actions)` dispatcher (validated, DI). Unit-tested.
- `src/lib/planning/orchestratorTurn.ts` *(new)* — the bounded agentic loop over `@anthropic-ai/sdk` (streams text via `onText`, executes tool calls via an injected `onToolCall`, feeds results back, max iterations). Reuses `makeAnthropic` + `fallbackModel` from `planningChat.ts`.
- `src/cadre/OrchestratorChat.tsx` — call `orchestratorTurn`, render inline tool-action rows, wire `onToolCall` → `runOrchestratorTool` with the real `useCadre` actions, journal + reportError.

---

## Task 1: Tool schemas + pure dispatcher

**Files:** Create `src/lib/planning/orchestratorTools.ts` + `orchestratorTools.test.ts`.

**Interfaces — Produces:**
```ts
import type { Tool } from "@anthropic-ai/sdk/resources/messages";

export const ORCHESTRATOR_TOOLS: Tool[]; // shard_story, shard_backlog, approve_story, dispatch_story, dispatch_ready

export interface OrchestratorActions {
  shardStory: (epic: number) => Promise<void>;
  shardBacklog: (epic: number) => Promise<void>;
  approveStory: (epic: number, story: number) => Promise<void>;
  dispatchStory: (epic: number, story: number) => Promise<void>;
  dispatchReady: () => Promise<void>;
}

export interface ToolOutcome { ok: boolean; message: string }

// Validate the tool name + args, run the mapped action, return an outcome string for
// the model. NEVER throws — an unknown tool or bad args returns { ok:false, message }.
export async function runOrchestratorTool(
  name: string, input: unknown, actions: OrchestratorActions
): Promise<ToolOutcome>;
```

- [ ] **Step 1: Write failing tests** (`orchestratorTools.test.ts`):

```ts
import { describe, it, expect, vi } from "vitest";
import { ORCHESTRATOR_TOOLS, runOrchestratorTool, type OrchestratorActions } from "./orchestratorTools";

function fakeActions(): OrchestratorActions & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    shardStory: async (e) => { calls.push(`shardStory ${e}`); },
    shardBacklog: async (e) => { calls.push(`shardBacklog ${e}`); },
    approveStory: async (e, s) => { calls.push(`approveStory ${e}.${s}`); },
    dispatchStory: async (e, s) => { calls.push(`dispatchStory ${e}.${s}`); },
    dispatchReady: async () => { calls.push(`dispatchReady`); },
  };
}

describe("orchestrator tools", () => {
  it("exposes the allowlist and NOT approve_plan", () => {
    const names = ORCHESTRATOR_TOOLS.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["shard_story","shard_backlog","approve_story","dispatch_story","dispatch_ready"]));
    expect(names).not.toContain("approve_plan");
  });
  it("dispatch_story runs the action with validated args", async () => {
    const a = fakeActions();
    const r = await runOrchestratorTool("dispatch_story", { epic: 1, story: 2 }, a);
    expect(r.ok).toBe(true);
    expect(a.calls).toContain("dispatchStory 1.2");
  });
  it("shard_story defaults epic to 1 when omitted", async () => {
    const a = fakeActions();
    await runOrchestratorTool("shard_story", {}, a);
    expect(a.calls).toContain("shardStory 1");
  });
  it("dispatch_ready needs no args", async () => {
    const a = fakeActions();
    const r = await runOrchestratorTool("dispatch_ready", {}, a);
    expect(r.ok).toBe(true);
    expect(a.calls).toContain("dispatchReady");
  });
  it("unknown tool → ok:false, does not throw", async () => {
    const a = fakeActions();
    const r = await runOrchestratorTool("rm_rf", {}, a);
    expect(r.ok).toBe(false);
    expect(a.calls).toHaveLength(0);
  });
  it("bad args (missing story) → ok:false, does not throw or call the action", async () => {
    const a = fakeActions();
    const r = await runOrchestratorTool("dispatch_story", { epic: 1 }, a);
    expect(r.ok).toBe(false);
    expect(a.calls).toHaveLength(0);
  });
  it("an action that throws is caught → ok:false", async () => {
    const a = fakeActions();
    a.dispatchStory = async () => { throw new Error("boom"); };
    const r = await runOrchestratorTool("dispatch_story", { epic: 1, story: 2 }, a);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/boom/);
  });
});
```

- [ ] **Step 2: Run — FAIL.** `npx vitest run src/lib/planning/orchestratorTools.test.ts`
- [ ] **Step 3: Implement `orchestratorTools.ts`** — define the 5 `Tool` schemas (each with a clear `description` and `input_schema`; `dispatch_story`/`approve_story` require `epic`+`story` integers; `shard_story`/`shard_backlog` take optional `epic` defaulting to 1; `dispatch_ready` takes no args). `runOrchestratorTool`: `switch(name)`, coerce/validate args (an integer helper `asInt(v)`), on invalid → `{ok:false, message:"..."}`; wrap the action call in try/catch → on throw `{ok:false, message: errorMessage(e)}` (import `errorMessage` from `../reportError`); on success `{ok:true, message:"..."}` (e.g. `"dispatched story 1.2"`).
- [ ] **Step 4: Run — PASS.** `npx vitest run src/lib/planning/orchestratorTools.test.ts && npx tsc --noEmit`
- [ ] **Step 5: Commit** — `git commit -am "feat(orchestrator): tool schemas + validated dispatcher (allowlist, no approve_plan)"`

## Task 2: The bounded agentic tool-loop

**Files:** Create `src/lib/planning/orchestratorTurn.ts` + `orchestratorTurn.test.ts`.

**Interfaces — Produces:**
```ts
import { type ChatMessage } from "./planningChat";

export interface OrchestratorTurnOpts {
  apiKey: string;
  baseUrl?: string;
  model: string;
  systemPrompt: string;
  messages: ChatMessage[];
  onText: (delta: string) => void;
  /** run a tool; returns the outcome fed back to the model. */
  onToolCall: (name: string, input: unknown) => Promise<{ ok: boolean; message: string }>;
  /** notify the UI a tool is about to run / finished (for inline rendering). */
  onToolEvent?: (e: { name: string; input: unknown; phase: "start" | "done"; ok?: boolean; message?: string }) => void;
  maxIterations?: number; // default 8
  signal?: AbortSignal;
}
export interface OrchestratorTurnResult { reply: string }
export async function orchestratorTurn(opts: OrchestratorTurnOpts): Promise<OrchestratorTurnResult>;
```

**Loop:** create the client via `makeAnthropic(apiKey, baseUrl)`. Maintain a working `messages` array (Anthropic message params). Up to `maxIterations`:
1. `stream = client.messages.stream({ model, system, tools: ORCHESTRATOR_TOOLS, messages, max_tokens })`; forward `stream.on("text", onText)`; `const final = await stream.finalMessage()`.
2. Collect `tool_use` blocks from `final.content`. If none → break (done).
3. Append `{ role:"assistant", content: final.content }`. For each tool_use: `onToolEvent({phase:"start"})`, `const outcome = await onToolCall(block.name, block.input)`, `onToolEvent({phase:"done", ok, message})`; build a `tool_result` block `{ type:"tool_result", tool_use_id: block.id, content: outcome.message, is_error: !outcome.ok }`.
4. Append `{ role:"user", content: [...toolResults] }`; loop.
On model-id error, retry once with `fallbackModel(model)` (mirror `planningTurn`). Return the concatenated assistant text as `reply`.

- [ ] **Step 1: Write a failing test** that exercises the loop WITHOUT the real SDK by injecting a fake client. Refactor the client creation to an injectable seam: `orchestratorTurn` takes an optional `_client?` (a minimal `{ messages: { stream } }` shape) defaulting to `makeAnthropic(...)`, OR extract the loop into a pure `runToolLoop(client, opts)` and test THAT with a fake client that returns a scripted sequence: first `finalMessage` yields a `tool_use` (dispatch_story), second yields text only (end). Assert: `onToolCall` was invoked with `("dispatch_story", {epic,story})`, `onToolEvent` fired start+done, the loop stopped after the text-only turn, and a `tool_result` with the outcome was fed back. Also assert `maxIterations` caps an always-tool-calling fake at 8.

```ts
// sketch — the implementer picks the exact seam (prefer a pure runToolLoop(client, opts))
it("runs a tool then finishes, feeding the result back", async () => { /* fake client, 2 turns */ });
it("caps at maxIterations when the model never stops calling tools", async () => { /* fake always-tool client */ });
```

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** `orchestratorTurn.ts` with the loop + the injectable client seam. Reuse `makeAnthropic`/`fallbackModel`/`isModelError` from `planningChat.ts` (export them if not already). Bound the loop; on the cap, stop and return what we have.
- [ ] **Step 4: Run — PASS** + `npx tsc --noEmit && npx vitest run`.
- [ ] **Step 5: Commit** — `git commit -am "feat(orchestrator): bounded agentic tool-loop (orchestratorTurn)"`

## Task 3: Wire OrchestratorChat to the controller

**Files:** `src/cadre/OrchestratorChat.tsx`.

- [ ] **Step 1** — replace the `planningTurn(...)` call in `send()` with `orchestratorTurn({...})`: pass the resolved `{apiKey, baseUrl}` (the component already resolves `planAuth`; reuse it — resolve fresh at send like today), the model, the system prompt (`ORCHESTRATOR_SYSTEM_PROMPT` + live context), `messages`, `onText` (stream into the assistant bubble as today), and `onToolCall: (name, input) => runOrchestratorTool(name, input, actions)` where `actions` maps to the store: `{ shardStory: (e)=>useCadre.getState().shardNextStory(e), shardBacklog: (e)=>useCadre.getState().shardBacklog(e), approveStory: (e,s)=>useCadre.getState().approveStory(e,s), dispatchStory: (e,s)=>useCadre.getState().dispatchStory(e,s), dispatchReady: ()=>useCadre.getState().dispatchReady() }`.
- [ ] **Step 2** — `onToolEvent`: append an inline tool-action row to the message stream (e.g. a small line `⚙ dispatch_story 1.2 — dispatched` on `done`, muted while `start`). Keep it simple: accumulate tool events into the current assistant message's rendered content, or a compact list above the reply. Journal each `done` via `logSession(root, ...)`.
- [ ] **Step 3** — update the system prompt / `ORCHESTRATOR_SYSTEM_PROMPT` (in `personas.ts`) to tell the model it now HAS these tools and should use them to act on the user's requests (shard/approve/dispatch), and that it must NOT claim to have done something it didn't call a tool for. Keep the existing "I can see the whole project" framing.
- [ ] **Step 4** — errors: an action failure comes back as `ok:false` (the model sees it and can react); ALSO `reportError` it so it hits the toast + AI Log. A thrown `orchestratorTurn` (network) → `reportError` + the existing catch.
- [ ] **Step 5** — `npx tsc --noEmit && npx vitest run` (196+) and `npm run build` green.
- [ ] **Step 6** — manual checklist (for the human): open the Orchestrator; type "shard a story for epic 1 and dispatch it" → confirm the tool rows appear, the story is sharded + dispatched (board updates), and the reply summarizes. Type "what's blocked?" → confirm it answers WITHOUT calling a tool (read-only). Confirm `approve_plan` is never callable.
- [ ] **Step 7: Commit** — `git commit -am "feat(orchestrator): the copilot acts via tools — shard, approve, dispatch inline"`

---

## Self-Review

**Spec coverage:** tool-calling controller → Task 1 (tools+dispatcher) + Task 2 (loop) + Task 3 (wire). allowlist, no approve_plan → Task 1 (schema + test). bounded loop → Task 2. real actions via useCadre → Task 3. journaled + reportError → Task 3. streamed text unchanged when no tools → Task 2 loop breaks on no-tool turn. ✓

**Type consistency:** `ORCHESTRATOR_TOOLS`, `OrchestratorActions`, `runOrchestratorTool`, `ToolOutcome`, `orchestratorTurn`, `OrchestratorTurnOpts`, `onToolCall`/`onToolEvent` used identically across tasks. `makeAnthropic`/`fallbackModel`/`errorMessage` reused from existing modules.

**Safety notes (documented):** actions execute without a separate confirm (the user directs the copilot; every action is visible inline + on the board + reversible). `approve_plan` excluded so the trust gate stays human. The dispatcher validates args and never throws into the loop. If a per-action confirm is wanted later, it slots into `onToolCall`.

**Placeholder scan:** none — Task 1 fully coded/tested; Task 2 specifies the loop + an injectable client seam with two concrete tests; Task 3 names exact files, the action map, and the inline-render approach, gated by build + the manual checklist.
