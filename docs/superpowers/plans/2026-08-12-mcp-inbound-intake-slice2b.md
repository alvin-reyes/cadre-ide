# MCP Inbound Intake — Slice 2b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tracker ticket flows into Cadre as work to plan→build — via `cadre intake <ticketId>` (CLI) and a desktop "Import from tracker" that pre-fills the plan composer — with the ticket→epic link recorded.

**Architecture:** A bounded read-only fetch agent pulls a ticket via the connected tracker MCP; a pure core (`mcpIntake.ts`) parses it and turns it into a brief; the CLI feeds `cmdPlan` and the desktop pre-fills the plan composer. Reuses Slice-2's tracker env/agent posture and the planning brain verbatim. A shared JSON scanner (extracted from `parseSyncResult`) backs both parsers.

**Tech Stack:** TypeScript, React 19, zustand, Tauri, Node `child_process`, vitest. No new deps.

**Spec:** `docs/superpowers/specs/2026-08-12-mcp-inbound-intake-slice2b-design.md` (binding).

## Global Constraints

- **Agent posture (same as Slice 2/3):** the fetch agent spawns `claude -p <prompt> --mcp-config <tracker.mcp.json> --allowedTools mcp__<id>__*` — NO `--dangerously-skip-permissions`; bounded by the same hard timeout as the sync agent (a hung fetch must never stall intake); read-only intent enforced by the prompt.
- **Secrets keychain-only** (Slice-1 invariant): tracker config `${VAR}` placeholders + child-env injection; no secret in files/args/logs/stdout.
- **Intake failure is LOUD** (unlike best-effort outbound sync): a fetch/parse error is a hard error surfaced to the user (CLI exit 1 / desktop `reportError`), never swallowed.
- **Desktop keeps human sign-off:** intake PRE-FILLS the plan composer; it does not auto-run the plan.
- **One implementation:** the balanced-JSON scanner is shared (`parseSyncResult` + `parseTicket` use the same code). Pure modules import no zustand/Tauri (CLI-reusable). Each task green: `npx tsc --noEmit` (+ `-p tsconfig.cli.json` for CLI tasks) + `npx vitest run <touched>`.

## File Structure

- Create `src/lib/integrations/jsonScan.ts` (+ test) — shared `findBalancedJsonObjects` / `lastJsonObject`; refactor `parseSyncResult`.
- Create `src/lib/integrations/mcpIntake.ts` (+ test) — `buildFetchPrompt`, `parseTicket`, `ticketToBrief`, `FetchedTicket`.
- Modify `src/lib/integrations/mcpTracker.ts` (+ test) — `epics` section, `recordEpicLink`, `epicTicket`.
- Create `src/cli/mcp/intakeNode.ts` (+ test); modify `src/cli/cadre.ts` — `cmdIntake` + `--build` + usage/dispatch.
- Create `src/stores/mcpIntakeStore.ts` (+ test); modify `src/cadre/PlanningStudio.tsx` — "Import from tracker" control.
- Modify `src/lib/demo/mockBackend.ts` + `scripts/e2e-extensive.mjs` — fetch-agent mock + e2e.

---

### Task 1: Shared JSON scanner

**Files:** Create `src/lib/integrations/jsonScan.ts`, `src/lib/integrations/jsonScan.test.ts`; Modify `src/lib/integrations/mcpTracker.ts` (`parseSyncResult`).

**Interfaces:**
```ts
/** Every top-level balanced-brace {...} span, string-aware (braces inside JSON
 *  string values don't desync). In source order. */
export function findBalancedJsonObjects(raw: string): string[];
/** The LAST balanced object that JSON-parses AND satisfies `ok` (default: is a
 *  non-null object). Returns the parsed value, or null if none qualifies. */
export function lastJsonObject<T = unknown>(raw: string, ok?: (v: unknown) => boolean): T | null;
```

- [ ] **Step 1: Write the failing test** (`jsonScan.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { findBalancedJsonObjects, lastJsonObject } from "./jsonScan";

describe("jsonScan", () => {
  it("finds top-level objects, string-aware (braces in strings don't desync)", () => {
    const objs = findBalancedJsonObjects('a {"x":"}{"} b {"y":1}');
    expect(objs).toEqual(['{"x":"}{"}', '{"y":1}']);
  });
  it("handles nested objects as one top-level span", () => {
    expect(findBalancedJsonObjects('{"a":{"b":{"c":1}}}')).toEqual(['{"a":{"b":{"c":1}}}']);
  });
  it("lastJsonObject returns the last qualifying object", () => {
    expect(lastJsonObject('{"taskId":"A"} then {"taskId":"B"}', (v: any) => !!v?.taskId))
      .toEqual({ taskId: "B" });
    expect(lastJsonObject('{"nope":1}', (v: any) => !!v?.taskId)).toBeNull();
    expect(lastJsonObject("no json")).toBeNull();
  });
});
```

- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement `jsonScan.ts`** — move the string-aware brace scanner out of `mcpTracker.ts` verbatim; `lastJsonObject` scans candidates last→first, `JSON.parse`-ing each in a try, returning the first that parses and satisfies `ok` (default `v && typeof v === "object"`).
- [ ] **Step 4: Refactor `mcpTracker.ts` `parseSyncResult`** to `const r = lastJsonObject(raw, v => typeof (v as any)?.taskId === "string" && (v as any).taskId.trim() !== ""); if (!r) throw …; return { taskId, url }`. Delete the now-duplicated local scanner. Keep ALL `mcpTracker.test.ts` tests green.
- [ ] **Step 5:** `npx vitest run src/lib/integrations/jsonScan.test.ts src/lib/integrations/mcpTracker.test.ts` + `npx tsc --noEmit` green.
- [ ] **Step 6: Commit** — `refactor(mcp): shared JSON scanner (parseSyncResult + intake share it)`

---

### Task 2: Pure intake core

**Files:** Create `src/lib/integrations/mcpIntake.ts`, `src/lib/integrations/mcpIntake.test.ts`.

**Interfaces:**
```ts
export interface FetchedTicket { id: string; title: string; description?: string; acceptanceCriteria?: string; url?: string; }
export function buildFetchPrompt(ticketRef: string): string;
export function parseTicket(raw: string): FetchedTicket;   // uses lastJsonObject; throws on missing id/title
export function ticketToBrief(ticket: FetchedTicket): string;
```

- [ ] **Step 1: Write the failing test** (`mcpIntake.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { buildFetchPrompt, parseTicket, ticketToBrief } from "./mcpIntake";

describe("mcpIntake core", () => {
  it("buildFetchPrompt names the ticket, is read-only, demands strict JSON", () => {
    const p = buildFetchPrompt("TCK-42");
    expect(p).toContain("TCK-42");
    expect(p).toMatch(/read|do not (modify|change|write)/i);
    expect(p).toMatch(/only.*json/i);
    expect(p).toMatch(/id|title|description|acceptance/i);
  });
  it("parseTicket extracts JSON (prose-wrapped, nested), requires id + title", () => {
    expect(parseTicket('here: {"id":"T-1","title":"Add login","description":"d","meta":{"a":1}}'))
      .toEqual({ id: "T-1", title: "Add login", description: "d", meta: undefined } as any) // shape below
      ;
    expect(() => parseTicket('{"id":"T-1"}')).toThrow();      // missing title
    expect(() => parseTicket('no json')).toThrow();
  });
  it("ticketToBrief includes title, description, acceptance, provenance footer", () => {
    const b = ticketToBrief({ id: "T-1", title: "Add login", description: "users log in", acceptanceCriteria: "email+pw" });
    expect(b).toContain("Add login");
    expect(b).toContain("users log in");
    expect(b).toContain("email+pw");
    expect(b).toMatch(/imported from tracker.*T-1/i);
  });
});
```
> Implementer: `parseTicket` returns ONLY the known fields (`id,title,description?,acceptanceCriteria?,url?`) — do not spread arbitrary keys; fix the first test's expectation to the exact returned shape.

- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement `mcpIntake.ts`.** `buildFetchPrompt`: "You have read-only access to a tracker via MCP tools. Fetch the ticket/issue with id/key `<ref>`. Do NOT modify anything. Reply with ONLY a JSON object: `{\"id\":\"…\",\"title\":\"…\",\"description\":\"…\",\"acceptanceCriteria\":\"…\",\"url\":\"…\"}` (omit unknown optional fields)." `parseTicket`: `lastJsonObject(raw, v => nonEmptyString(v.id) && nonEmptyString(v.title))`, then pick the known fields. `ticketToBrief`: a Markdown brief — `# <title>`, the description, an `## Acceptance criteria` block if present, and a final `_Imported from tracker <id>._` line.
- [ ] **Step 4: green. Step 5: Commit** — `feat(mcp): pure intake core (fetch prompt, parse ticket, ticket→brief)`

---

### Task 3: Tracker file epic link

**Files:** Modify `src/lib/integrations/mcpTracker.ts`, `src/lib/integrations/mcpTracker.test.ts`.

**Interfaces:**
- Extend `McpTrackerFile` with `epics?: Record<string, { ticketId: string; url?: string }>`.
- `export function recordEpicLink(file: McpTrackerFile, epic: number, link: { ticketId: string; url?: string }): McpTrackerFile;` (immutable; returns a new file with `epics[String(epic)] = link`).
- `export function epicTicket(file: McpTrackerFile, epic: number): { ticketId: string; url?: string } | undefined;`
- `emptyTrackerFile` seeds `epics: {}`; `trackerFromFile` tolerates a MISSING `epics` (old files → treat as `{}`), still `version:1`.

- [ ] **Step 1: Write failing tests** — `recordEpicLink`/`epicTicket` round-trip; `trackerFromFile` on a file with NO `epics` key returns a file whose `epics` is `{}` (back-compat); `trackerToFile`→`trackerFromFile` preserves `epics`.
- [ ] **Step 2: fail. Step 3: Implement** (keep existing tracker tests green — `emptyTrackerFile` shape changes to include `epics:{}`, so update any test asserting its exact shape). **Step 4: green. Step 5: Commit** — `feat(mcp): tracker file epic↔ticket link (recordEpicLink/epicTicket)`

---

### Task 4: CLI `cadre intake`

**Files:** Create `src/cli/mcp/intakeNode.ts`, `src/cli/mcp/intakeNode.test.ts`; Modify `src/cli/cadre.ts`.

**Interfaces:**
```ts
export type RunFetchAgentNode = (args: { prompt: string; mcpConfigPath: string; env: Record<string,string>; serverKey: string; cwd: string }) => Promise<string>;
export function realRunFetchAgentNode(): RunFetchAgentNode;   // same spawn+timeout+allowlist as realRunSyncAgentNode
// Resolve tracker env, run fetch agent, parseTicket. Throws (loud) on no-tracker / agent / parse failure.
export function fetchTicketNode(io: NodeIo, root: string, ticketRef: string, deps?: { resolveTrackerEnv?: …; runFetchAgent?: RunFetchAgentNode }): Promise<FetchedTicket>;
```
Reuse: `resolveTrackerEnvNode` (`connectionsNode.ts`), `buildFetchPrompt`/`parseTicket`/`ticketToBrief` (`mcpIntake.ts`), the timeout constant + spawn shape from `trackerSyncNode.ts` `realRunSyncAgentNode` (factor the shared spawn if clean, else parallel it).

`cmdIntake(ticketRef, projectDir, opts: { build: boolean })` in `cadre.ts`:
- No tracker connection (`resolveTrackerEnvNode` → null) → error + exit 1 ("designate a tracker: cadre connect <preset> --as-tracker").
- `fetchTicketNode` → `FetchedTicket`; log `imported <id>: <title>`. On failure → error + exit 1 (LOUD).
- `ticketToBrief(ticket)` → `cmdPlan(brief, projectDir)`; if that returns non-zero, propagate.
- On plan success, `recordEpicLink(file, 1, { ticketId: ticket.id, url: ticket.url })` → write `.cadre/mcp-tracker.json` (read via `io.readFile` ENOENT→empty; malformed/transient → log a warning and skip the link write, don't fail the intake since the plan already succeeded).
- If `--build`: chain `cmdShard` → `cmdApprove(--all)` → `cmdRun(--auto)` (like `cmdBuild`).
- Add to `usage()` + `main()` dispatch (`intake <ticketId> [dir] [--build]`).

- [ ] **Step 1: Write failing tests** (`intakeNode.test.ts`, in-memory NodeIo + stub fetch agent): `fetchTicketNode` with a stub returning ticket JSON → parsed ticket; no tracker → throws; agent reject/timeout → throws (loud); parse failure → throws. (cmdIntake's plan chaining is covered by a light test mocking `cmdPlan` if feasible, else rely on the pure pieces + manual smoke.)
- [ ] **Step 2: fail. Step 3: Implement** `intakeNode.ts` + `cmdIntake` + usage/dispatch.
- [ ] **Step 4:** both tscs + `npx vitest run` green. Manual smoke: `node dist-cli/cli/cadre.js help` shows `intake`; `node dist-cli/cli/cadre.js intake TCK-1 /tmp/no-tracker` errors with the "designate a tracker" message.
- [ ] **Step 5: Commit** — `feat(cli): cadre intake — ticket → brief → plan`

---

### Task 5: Desktop intake store + "Import from tracker" UI

**Files:** Create `src/stores/mcpIntakeStore.ts`, `src/stores/mcpIntakeStore.test.ts`; Modify `src/cadre/PlanningStudio.tsx`.

**Store (`mcpIntakeStore.ts`):**
```ts
interface McpIntakeState {
  importing: boolean;
  fetchTicket(root: string, ticketRef: string): Promise<FetchedTicket | null>;  // null on failure (already reportError'd)
  __setRunFetchAgent(fn: RunFetchAgent): void;   // test seam
}
```
`fetchTicket`: `useConnectionsStore.getState().resolveTrackerEnv(root)` → null → `reportError("intake: no tracker connection", …)` + return null. Spawn the fetch agent (same bounded, least-privilege claude spawn as `mcpTrackerStore.defaultRunSyncAgent` — factor a shared spawn helper or parallel it), `parseTicket(stdout)`. Any failure → `reportError` + return null. Never throws.

**UI (`PlanningStudio.tsx`):** an **"Import from tracker"** control near the composer (`draft`/`setDraft` at line ~145): a small input for the ticket id + a button, shown only when a tracker connection is designated (`useConnectionsStore` → `trackerConnection(connections)` truthy). On submit → `useMcpIntakeStore.fetchTicket(root, id)`; on a returned ticket → `setDraft(ticketToBrief(ticket))` (pre-fill the composer — the human reviews + sends) and `recordEpicLink`-persist via a small store write (or defer link to when the plan is approved; MVP: write the link to `.cadre/mcp-tracker.json` on successful fetch keyed epic 1). Disable + show a spinner while `importing`. Theme-token styled, reuse existing atoms.

- [ ] **Step 1: Write failing store tests** (mock spawn + `resolveTrackerEnv` + `reportError`): stub agent → `fetchTicket` returns parsed ticket; no tracker → null + reportError; rejecting agent → null + reportError, no throw; no secret in spawned args.
- [ ] **Step 2: fail. Step 3: Implement** store + the PlanningStudio control (`setDraft(ticketToBrief(ticket))` seam).
- [ ] **Step 4:** `npx tsc --noEmit` green; store tests green; demo smoke (`?demo=1`, plan view) — the control renders when a tracker is designated, Import pre-fills the composer (with the Task-6 mock), no console errors.
- [ ] **Step 5: Commit** — `feat(mcp): desktop Import from tracker (pre-fills the plan composer)`

---

### Task 6: Demo mock + e2e

**Files:** Modify `src/lib/demo/mockBackend.ts`, `scripts/e2e-extensive.mjs`.

- [ ] **Step 1: Demo fetch agent.** In `mockBackend`'s `create_pty` handler, detect the FETCH agent (args include `--mcp-config` with `tracker.mcp.json` AND the prompt is a fetch prompt — distinguish from the SYNC agent, e.g. the fetch prompt contains "Fetch the ticket" / lacks the sync's "Set the task status"). Stream a canned ticket reply `{"id":"MOCK-1","title":"Imported demo ticket","description":"…","acceptanceCriteria":"…"}` before exit so `parseTicket` succeeds. Keep sync-agent + other transcripts unchanged. (If distinguishing fetch vs sync by args is fragile, key the fetch on a marker only the fetch prompt has.)
- [ ] **Step 2: e2e.** Extend `e2e-extensive.mjs`: with a tracker designated (the Slice-2 step designates GitHub as tracker), open the plan surface, use **Import from tracker** (enter `MOCK-1`, submit), assert the composer (`draft`) is pre-filled with the imported title/brief text. Preserve the zero-console-error gate. Screenshot `ext-12-intake.png`.
- [ ] **Step 3:** `npm run test:e2e:extensive` PASS 0 console errors; both tscs + `npx vitest run` green.
- [ ] **Step 4: Commit** — `test(mcp): demo fetch-agent mock + Import-from-tracker e2e`

---

## Self-Review

- **Spec coverage:** shared scanner (T1), pure intake core §1 (T2), link-back §2 (T3), CLI §3 (T4), desktop §4 (T5), demo/e2e §6 (T6). ✓
- **Placeholder scan:** T1–T3 carry real code/tests; T4–T5 carry exact contracts + test lists (reuse Slice-2/3 patterns); T6 concrete assertions. The one soft spot — distinguishing fetch vs sync agent in the demo mock — is called out with a fallback (a fetch-only marker).
- **Type consistency:** `FetchedTicket` (T2) consumed by T4/T5/T6; `lastJsonObject` (T1) used by `parseSyncResult` + `parseTicket`; `McpTrackerFile.epics` (T3) used by `recordEpicLink`; `RunFetchAgentNode`/`RunFetchAgent` mirror the sync agent's arg shape; `.cadre/mcp-tracker.json` unchanged filename, `epics` back-compatible.
- **Global constraints** (loud failure, bounded+least-privilege+read-only fetch agent, secrets keychain-only, desktop human sign-off, shared scanner) enforced by T2 prompt tests, T4 loud-error + no-tracker tests, T5 store reportError + no-secret tests, and the shared T1 scanner.
