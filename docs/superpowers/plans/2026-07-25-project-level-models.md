# Project-Level Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move planning/fleet model + fleet provider selection from a global inline Execute-screen dropdown to per-project config stored in each project's `cadre.json`, with resolution falling back to the global default.

**Architecture:** A new pure parser (`parseModels`) reads a `models` object from `cadre.json`. A new Zustand store (`modelsStore`) mirrors `reposStore`/`trackerStore`: it loads the active project's models and writes them back via a read-modify-write of the manifest that preserves all other keys. `useCadre`'s three model/provider resolution seams prefer the project's models, then global settings, then the hardcoded default. The `FleetModelPicker` is removed from the two Execute views; Settings edits the active project's models instead of global settings.

**Tech Stack:** React 18 + TypeScript + Zustand + Tauri (`invoke("read_file")` / `invoke("write_text_file")`), Vitest (node environment).

## Global Constraints

- Backward-compat: a `cadre.json` with no `models` key behaves exactly as today (global settings / hardcoded default used). Real Tauri AND demo mode both work.
- Known provider ids are exactly: `claude`, `deepseek`, `kimi` (from `PROVIDERS` in `src/lib/engine/providers.ts`). An unknown `provider` value is dropped.
- All store `invoke` calls are wrapped and routed to `reportError("project models", e)` — the store NEVER throws past its own methods.
- Writes are read-modify-write of the FULL `cadre.json` — never clobber `name`, `cadre`, `createdAt`, `repos`, or `tracker`. (Mirror `persistRepos` in `src/stores/reposStore.ts:53-66`.)
- The default planning model constant is `MODEL = "claude-opus-4-8"` (`src/cadre/useCadre.ts:58`).
- Vitest test files are colocated (`module.ts` + `module.test.ts`), node environment (`vitest.config.ts`: `include: ["src/**/*.test.ts"]`).
- Final gates must all be green: `npx tsc --noEmit`, `npx vitest run` (502 baseline + new tests), `npm run build`.
- Final commit message (exact): `feat(models): project-level model config in cadre.json; remove the Execute model picker`

---

### Task 1: Pure `parseModels` parser + test

**Files:**
- Create: `src/lib/engine/models.ts`
- Test: `src/lib/engine/models.test.ts`

**Interfaces:**
- Consumes: nothing (framework-free, like `src/lib/engine/repos.ts`).
- Produces:
  - `export interface ProjectModels { planning?: string; fleet?: string; provider?: string }`
  - `export function parseModels(manifestJson: string): ProjectModels`
  - `export const KNOWN_PROVIDER_IDS: readonly string[]` = `["claude", "deepseek", "kimi"]`

**Behavior contract (tolerant):**
- Parse the JSON; on parse error return `{}`.
- Read the top-level `models` key. If absent or not a plain object, return `{}`.
- `planning`: keep only if it's a non-empty string.
- `fleet`: keep only if it's a non-empty string.
- `provider`: keep only if it's a string AND one of `KNOWN_PROVIDER_IDS`; otherwise drop.
- Never include a key whose value was dropped (result has only the kept keys).

- [ ] **Step 1: Write the failing test**

Create `src/lib/engine/models.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseModels } from "./models";

describe("parseModels", () => {
  it("returns {} when cadre.json has no models key", () => {
    expect(parseModels('{"name":"Acme","repos":[]}')).toEqual({});
  });

  it("returns {} for corrupt / non-JSON input", () => {
    expect(parseModels("{ not json")).toEqual({});
    expect(parseModels("")).toEqual({});
  });

  it("returns {} when models is not an object", () => {
    expect(parseModels('{"models":"nope"}')).toEqual({});
    expect(parseModels('{"models":42}')).toEqual({});
    expect(parseModels('{"models":null}')).toEqual({});
    expect(parseModels('{"models":["a"]}')).toEqual({});
  });

  it("keeps planning and fleet string values", () => {
    expect(
      parseModels('{"models":{"planning":"claude-opus-4-8","fleet":"kimi-k2"}}')
    ).toEqual({ planning: "claude-opus-4-8", fleet: "kimi-k2" });
  });

  it("drops empty-string and non-string planning/fleet", () => {
    expect(parseModels('{"models":{"planning":"","fleet":5}}')).toEqual({});
  });

  it("keeps a known provider id", () => {
    expect(parseModels('{"models":{"provider":"deepseek"}}')).toEqual({ provider: "deepseek" });
    expect(parseModels('{"models":{"provider":"claude"}}')).toEqual({ provider: "claude" });
    expect(parseModels('{"models":{"provider":"kimi"}}')).toEqual({ provider: "kimi" });
  });

  it("drops an unknown or malformed provider", () => {
    expect(parseModels('{"models":{"provider":"openai"}}')).toEqual({});
    expect(parseModels('{"models":{"provider":123}}')).toEqual({});
  });

  it("keeps valid fields and drops invalid ones together", () => {
    expect(
      parseModels('{"models":{"planning":"m1","fleet":"","provider":"bogus"}}')
    ).toEqual({ planning: "m1" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/engine/models.test.ts`
Expected: FAIL — cannot resolve `./models`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/engine/models.ts`:

```typescript
/**
 * Project-level model config, read from the `models` object in a project's
 * cadre.json. All fields optional — a missing/corrupt manifest yields {}, and
 * callers fall back to the global settings / hardcoded default. Pure and
 * framework-free (mirrors src/lib/engine/repos.ts) so it's unit-testable
 * without Zustand or Tauri.
 */
export interface ProjectModels {
  planning?: string;
  fleet?: string;
  provider?: string;
}

/** Provider ids Cadre knows how to route to (must match PROVIDERS in providers.ts). */
export const KNOWN_PROVIDER_IDS = ["claude", "deepseek", "kimi"] as const;

export function parseModels(manifestJson: string): ProjectModels {
  let manifest: { models?: unknown } = {};
  try {
    manifest = JSON.parse(manifestJson) ?? {};
  } catch {
    return {};
  }
  const raw = manifest.models;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: ProjectModels = {};
  if (typeof o.planning === "string" && o.planning) out.planning = o.planning;
  if (typeof o.fleet === "string" && o.fleet) out.fleet = o.fleet;
  if (typeof o.provider === "string" && (KNOWN_PROVIDER_IDS as readonly string[]).includes(o.provider)) {
    out.provider = o.provider;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/engine/models.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/models.ts src/lib/engine/models.test.ts
git commit -m "feat(models): pure parseModels parser for cadre.json models block"
```

---

### Task 2: `modelsStore` Zustand store + persist-merge test

**Files:**
- Create: `src/stores/modelsStore.ts`
- Test: `src/stores/modelsStore.test.ts`

**Interfaces:**
- Consumes: `parseModels`, `ProjectModels` from `../lib/engine/models` (Task 1); `reportError` from `../lib/reportError`; `invoke` from `@tauri-apps/api/core`.
- Produces:
  - `export function mergeModelsIntoManifest(rawManifest: string, patch: Partial<ProjectModels>): string` — pure read-modify-write helper (unit-tested). Parses `rawManifest` (empty/corrupt → `{}`), merges `patch` into the existing `models` object (dropping keys whose patch value is empty string or undefined), and returns the FULL manifest JSON re-serialized with `JSON.stringify(manifest, null, 2)`, preserving all other keys.
  - `export const useModelsStore` — Zustand store with:
    - state `models: ProjectModels` (initial `{}`)
    - `load: (root: string) => Promise<void>` — read `${root}/cadre.json` via `invoke("read_file")`, `parseModels`, `set({ models })`; tolerant (any error → `reportError` + leave/set `{}`).
    - `setModels: (root: string, patch: Partial<ProjectModels>) => Promise<void>` — read raw manifest, `mergeModelsIntoManifest`, write full manifest back via `invoke("write_text_file")`, then `set({ models: parseModels(nextRaw) })`. All wrapped → `reportError("project models", e)`, never throw.

**Merge contract (`mergeModelsIntoManifest`):**
- Start from parsed manifest (`{}` on corrupt/empty).
- `next = { ...manifest.models-as-object-or-{} }`.
- For each key in patch: if value is a non-empty string, set it; if value is `""` or `undefined`, delete the key.
- If `next` has no keys, remove the `models` key entirely (keeps a clean manifest); else assign `manifest.models = next`.
- Return `JSON.stringify(manifest, null, 2)`.

- [ ] **Step 1: Write the failing test**

Create `src/stores/modelsStore.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { mergeModelsIntoManifest } from "./modelsStore";

describe("mergeModelsIntoManifest", () => {
  it("adds a models block without clobbering other keys", () => {
    const raw = JSON.stringify({ cadre: 1, name: "Acme", repos: [{ id: "main" }], tracker: { enabled: true } });
    const out = JSON.parse(mergeModelsIntoManifest(raw, { planning: "claude-opus-4-8" }));
    expect(out.name).toBe("Acme");
    expect(out.repos).toEqual([{ id: "main" }]);
    expect(out.tracker).toEqual({ enabled: true });
    expect(out.models).toEqual({ planning: "claude-opus-4-8" });
  });

  it("merges into an existing models block", () => {
    const raw = JSON.stringify({ name: "Acme", models: { planning: "m1" } });
    const out = JSON.parse(mergeModelsIntoManifest(raw, { fleet: "kimi-k2", provider: "kimi" }));
    expect(out.models).toEqual({ planning: "m1", fleet: "kimi-k2", provider: "kimi" });
  });

  it("removes a key when patched with empty string", () => {
    const raw = JSON.stringify({ name: "Acme", models: { planning: "m1", fleet: "f1" } });
    const out = JSON.parse(mergeModelsIntoManifest(raw, { fleet: "" }));
    expect(out.models).toEqual({ planning: "m1" });
  });

  it("removes the models block entirely when it becomes empty", () => {
    const raw = JSON.stringify({ name: "Acme", models: { planning: "m1" } });
    const out = JSON.parse(mergeModelsIntoManifest(raw, { planning: "" }));
    expect("models" in out).toBe(false);
    expect(out.name).toBe("Acme");
  });

  it("starts from {} on corrupt/empty manifest", () => {
    const out = JSON.parse(mergeModelsIntoManifest("", { planning: "m1" }));
    expect(out).toEqual({ models: { planning: "m1" } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/modelsStore.test.ts`
Expected: FAIL — cannot resolve `./modelsStore`.

- [ ] **Step 3: Write minimal implementation**

Create `src/stores/modelsStore.ts`:

```typescript
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { parseModels, type ProjectModels } from "../lib/engine/models";
import { reportError } from "../lib/reportError";

const manifestPath = (root: string) => `${root}/cadre.json`;

/** Read cadre.json as raw text; return "" on any error. */
async function readManifestRaw(root: string): Promise<string> {
  try {
    return await invoke<string>("read_file", { path: manifestPath(root) });
  } catch {
    return "";
  }
}

/**
 * Pure read-modify-write: splice `patch` into the manifest's `models` block and
 * return the FULL manifest JSON. Preserves all other keys (name, cadre,
 * createdAt, repos, tracker). Empty-string / undefined patch values delete their
 * key; an emptied models block is removed entirely. Corrupt/empty input → {}.
 */
export function mergeModelsIntoManifest(rawManifest: string, patch: Partial<ProjectModels>): string {
  let manifest: Record<string, unknown> = {};
  try {
    manifest = JSON.parse(rawManifest) ?? {};
  } catch {
    /* start from empty object */
  }
  const existing = manifest.models && typeof manifest.models === "object" && !Array.isArray(manifest.models)
    ? (manifest.models as Record<string, unknown>)
    : {};
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(existing)) {
    if (typeof v === "string" && v) next[k] = v;
  }
  for (const [k, v] of Object.entries(patch)) {
    if (typeof v === "string" && v) next[k] = v;
    else delete next[k];
  }
  if (Object.keys(next).length === 0) delete manifest.models;
  else manifest.models = next;
  return JSON.stringify(manifest, null, 2);
}

// ---------------------------------------------------------------------------
// Zustand store — holds the ACTIVE project's models. Mirrors reposStore/
// trackerStore: load(root) on open, setModels(root, patch) writes back.
// ---------------------------------------------------------------------------

interface ModelsState {
  models: ProjectModels;
  /** Read the active project's models from cadre.json. Tolerant. */
  load: (root: string) => Promise<void>;
  /** Merge a patch into cadre.json's models block and persist. Tolerant. */
  setModels: (root: string, patch: Partial<ProjectModels>) => Promise<void>;
}

export const useModelsStore = create<ModelsState>((set) => ({
  models: {},

  load: async (root: string) => {
    try {
      const raw = await readManifestRaw(root);
      set({ models: parseModels(raw) });
    } catch (e) {
      reportError("project models", e);
      set({ models: {} });
    }
  },

  setModels: async (root: string, patch: Partial<ProjectModels>) => {
    try {
      const raw = await readManifestRaw(root);
      const nextRaw = mergeModelsIntoManifest(raw, patch);
      await invoke("write_text_file", { path: manifestPath(root), content: nextRaw });
      set({ models: parseModels(nextRaw) });
    } catch (e) {
      reportError("project models", e);
    }
  },
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/stores/modelsStore.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stores/modelsStore.ts src/stores/modelsStore.test.ts
git commit -m "feat(models): modelsStore with merge-preserving cadre.json write-back"
```

---

### Task 3: Project-aware resolution in `useCadre`

**Files:**
- Modify: `src/cadre/useCadre.ts`
  - `planningModel()` at `:61-63`
  - `fleetModelOverride()` at `:66-68`
  - Add a `fleetProviderId()` helper near them.
  - Provider resolution at the four sites currently `getProvider(get().fleetProvider)`: `:717`, `:836`, `:1067`, `:1124`.

**Interfaces:**
- Consumes: `useModelsStore` from `../stores/modelsStore` (Task 2); existing `useSettingsStore`, `getProvider`, `MODEL`.
- Produces: `export function fleetProviderId(): string` — `useModelsStore.getState().models.provider || useCadre.getState().fleetProvider`. (Used at the four `getProvider(...)` sites so the project's provider wins, else the global.)

**Resolution precedence (unchanged fallbacks, project added on top):**
- planning model: `project.models.planning` → `settings.planningModel` → `MODEL`.
- fleet model override: `project.models.fleet` → `settings.fleetModel` → `""`.
- fleet provider: `project.models.provider` → global `fleetProvider` state.

Note: `useCadre` is defined below these functions; referencing `useCadre.getState()` inside `fleetProviderId` is safe because it's only called at runtime (the four sites are inside store actions), after the store exists — same pattern reposStore uses to call `useCadre.getState()`.

- [ ] **Step 1: Edit `planningModel()` and `fleetModelOverride()`, add `fleetProviderId()`**

Add the import at the top of the file (with the other store imports, after the `useSettingsStore` import at `:5`):

```typescript
import { useModelsStore } from "../stores/modelsStore";
```

Replace `src/cadre/useCadre.ts:60-68`:

```typescript
/** The configured planning-brain model — project override, else Settings, else the default. */
export function planningModel(): string {
  return useModelsStore.getState().models.planning || useSettingsStore.getState().planningModel || MODEL;
}

/** The fleet-model override — project override, else Settings (empty → caller uses provider default). */
export function fleetModelOverride(): string {
  return useModelsStore.getState().models.fleet || useSettingsStore.getState().fleetModel || "";
}

/** The fleet provider id — project override, else the global fleetProvider state. */
export function fleetProviderId(): string {
  return useModelsStore.getState().models.provider || useCadre.getState().fleetProvider;
}
```

- [ ] **Step 2: Point the four provider-resolution sites at `fleetProviderId()`**

At each of `:717`, `:836`, `:1067`, `:1124` change:

```typescript
const provider = getProvider(get().fleetProvider);
```

to:

```typescript
const provider = getProvider(fleetProviderId());
```

(There are exactly four occurrences of `getProvider(get().fleetProvider)`. Replace all four. Verify with `grep -n "getProvider(get().fleetProvider)" src/cadre/useCadre.ts` returning nothing afterward.)

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify existing tests still pass**

Run: `npx vitest run`
Expected: PASS — baseline 502 + Task 1/2 tests, no regressions. (`planningModel`/`fleetModelOverride`/`fleetProviderId` all fall back to global when `models` is `{}`, so existing behavior is preserved.)

- [ ] **Step 5: Commit**

```bash
git add src/cadre/useCadre.ts
git commit -m "feat(models): resolve planning/fleet model + provider from project, fall back to global"
```

---

### Task 4: Load project models on open (real + demo)

**Files:**
- Modify: `src/cadre/CadreApp.tsx:100-101` (add `useModelsStore.getState().load(projectRoot)` next to the existing `useRepos.getState().load(projectRoot)`).
- Modify: `src/lib/demo/demoMode.ts` (around `:246-250`, after `openProject` / `hydrateFromProject`, add the models load for `DEMO_ROOT`).

**Interfaces:**
- Consumes: `useModelsStore` from `../stores/modelsStore` (Task 2).
- Produces: nothing new — this wires load into the existing project-open path so `useModelsStore.getState().models` reflects the active project before dispatch/planning resolve.

- [ ] **Step 1: Wire load in CadreApp**

In `src/cadre/CadreApp.tsx`, add the import (near the existing `useRepos` import):

```typescript
import { useModelsStore } from "../stores/modelsStore";
```

In the `useEffect` at `:94-110`, immediately after the existing line:

```typescript
      // Load the repo registry from cadre.json so RepoRegistry and per-repo verify gate are current.
      useRepos.getState().load(projectRoot);
```

add:

```typescript
      // Load this project's model config from cadre.json (falls back to global when absent).
      useModelsStore.getState().load(projectRoot);
```

- [ ] **Step 2: Wire load in demo mode**

In `src/lib/demo/demoMode.ts`, add the import at the top (with the other store imports):

```typescript
import { useModelsStore } from "../../stores/modelsStore";
```

After the `hydrateFromProject()` call (`:250`), add:

```typescript
  // Load the demo project's model config (no models key → global default; parity with real open).
  await useModelsStore.getState().load(DEMO_ROOT);
```

(Confirm the relative import depth: `demoMode.ts` is at `src/lib/demo/`, so the store is `../../stores/modelsStore`. Verify against how `useBmadStore` is imported in the same file and match its `../../stores/...` prefix.)

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify tests pass**

Run: `npx vitest run`
Expected: PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/cadre/CadreApp.tsx src/lib/demo/demoMode.ts
git commit -m "feat(models): load project models on open (real + demo)"
```

---

### Task 5: Remove the FleetModelPicker from both Execute views

**Files:**
- Modify: `src/cadre/KanbanBoard.tsx:35` (import) and `:911-914` (JSX).
- Modify: `src/cadre/AgentOrgChart.tsx:16` (import) and `:582-585` (JSX).

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing — pure removal. `FleetModelPicker` stays defined and exported in `agentShared.tsx` (still used by Settings via the provider select; do NOT delete the component).

Note: both files also import `stateInfo` and `LiveTerminal` from `./agentShared` and still use them — so keep the import line, only remove `FleetModelPicker` from the named-import list.

- [ ] **Step 1: Remove from KanbanBoard**

In `src/cadre/KanbanBoard.tsx:35` change:

```typescript
import { stateInfo, LiveTerminal, FleetModelPicker } from "./agentShared";
```

to:

```typescript
import { stateInfo, LiveTerminal } from "./agentShared";
```

Then delete the JSX block at `:911-914`:

```tsx
        <div style={{ flex: 1 }} />

        {/* Fleet model picker */}
        <FleetModelPicker />
```

Keep the surrounding `</div>` that closed the bar. (After removal, the `<div style={{ flex: 1 }} />` spacer that was paired only with the picker goes too — verify the bar layout still closes correctly by reading the 8 lines around the edit.)

- [ ] **Step 2: Remove from AgentOrgChart**

In `src/cadre/AgentOrgChart.tsx:16` change:

```typescript
import { stateInfo, LiveTerminal, FleetModelPicker } from "./agentShared";
```

to:

```typescript
import { stateInfo, LiveTerminal } from "./agentShared";
```

Then delete the JSX block at `:582-585`:

```tsx
        <div style={{ flex: 1 }} />

        {/* Fleet model picker */}
        <FleetModelPicker />
```

- [ ] **Step 3: Verify no other Execute-file usage remains and types compile**

Run: `grep -rn "FleetModelPicker" src/cadre/KanbanBoard.tsx src/cadre/AgentOrgChart.tsx`
Expected: no output.

Run: `grep -rn "FleetModelPicker" src/`
Expected: only `agentShared.tsx` (definition/export) and `Settings.tsx` if still referenced — confirm the Execute files are gone.

Run: `npx tsc --noEmit`
Expected: no errors (no unused-import error, since `stateInfo`/`LiveTerminal` remain used).

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src/cadre/KanbanBoard.tsx src/cadre/AgentOrgChart.tsx
git commit -m "feat(models): remove the inline FleetModelPicker from the Execute views"
```

---

### Task 6: Settings → per-project models

**Files:**
- Modify: `src/cadre/Settings.tsx` — the `Models` section (`:83-117`), plus imports and the component's store wiring (`:29-54`).

**Interfaces:**
- Consumes: `useModelsStore` (Task 2); `useBmadStore` (already imported at `:10`) for `projectRoot`; existing `useSettingsStore` global model fields as the placeholder/default source; `PROVIDERS` / `getProvider`.
- Produces: nothing new.

**UX contract:**
- Read `const projectRoot = useBmadStore((s) => s.projectRoot)`.
- Read `const projectModels = useModelsStore((s) => s.models)` and `const setModels = useModelsStore((s) => s.setModels)`.
- Global fields (`planningModel`, `fleetModel`, `fleetProvider` + their setters) remain read for computing placeholders/defaults.
- **When a project is open (`projectRoot` truthy):** the three fields edit the PROJECT.
  - Planning brain input: `value={projectModels.planning ?? ""}`, `onChange` → `setModels(projectRoot, { planning: e.target.value })`, `placeholder={planningModel || "claude-opus-4-8"}` (the global default).
  - Dev fleet provider select: `value={projectModels.provider ?? fleetProvider}`, `onChange` → `setModels(projectRoot, { provider: e.target.value })`.
  - Dev fleet model input: `value={projectModels.fleet ?? ""}`, `onChange` → `setModels(projectRoot, { fleet: e.target.value })`, `placeholder={effectiveProvider.defaultModel}` where `effectiveProvider = PROVIDERS[projectModels.provider ?? fleetProvider] ?? PROVIDERS.claude`.
- **When no project is open (`projectRoot` falsy):** fall back to editing the GLOBAL settings exactly as today (`planningModel`/`setPlanningModel`, `fleetModel`/`setFleetModel`, `fleetProvider`/`setFleetProvider`) so Settings is never broken with no project.
- Section subtitle: when a project is open, note the models apply to THIS project; otherwise keep the global wording.
- Keep the existing `Section`/`Field`/`inputStyle`/`datalist` styling untouched.

- [ ] **Step 1: Add the model-store + project-root wiring**

In `src/cadre/Settings.tsx`, add the import (with the other store imports near `:9-10`):

```typescript
import { useModelsStore } from "../stores/modelsStore";
```

Inside the `Settings` component, after the existing `fleetProvider`/`setFleetProvider` lines (`:51-52`) and the `provider` derivation (`:54`), add:

```typescript
  const projectRoot = useBmadStore((s) => s.projectRoot);
  const projectModels = useModelsStore((s) => s.models);
  const setProjectModels = useModelsStore((s) => s.setModels);

  // Effective provider drives the fleet-model placeholder (its default model).
  const effectiveProviderId = projectRoot ? (projectModels.provider ?? fleetProvider) : fleetProvider;
  const effectiveProvider = PROVIDERS[effectiveProviderId] ?? PROVIDERS.claude;
```

- [ ] **Step 2: Rewrite the three model Fields to be project-aware**

Replace the Section opening + the three Fields (`src/cadre/Settings.tsx:84-117`) with:

```tsx
        {/* Models */}
        <Section
          icon={Cpu}
          title="Models"
          subtitle={
            projectRoot
              ? "Models for THIS project — saved to its cadre.json. Blank = the global default. The engine verifies either way."
              : "The planning brain thinks; the dev fleet builds. Open a project to set its models; these are the global defaults."
          }
        >
          <Field label="Planning brain" hint="PM · Architect · Designer · sharding · plan validation · reviews">
            <input
              list="cadre-planning-models"
              value={projectRoot ? (projectModels.planning ?? "") : planningModel}
              onChange={(e) =>
                projectRoot
                  ? setProjectModels(projectRoot, { planning: e.target.value })
                  : setPlanningModel(e.target.value)
              }
              placeholder={projectRoot ? (planningModel || "claude-opus-4-8") : "claude-opus-4-8"}
              style={inputStyle}
            />
            <datalist id="cadre-planning-models">
              {PLANNING_MODEL_SUGGESTIONS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>

          <Field label="Dev fleet provider" hint="Which model provider the Dev/QA fleet runs on">
            <select
              value={projectRoot ? (projectModels.provider ?? fleetProvider) : fleetProvider}
              onChange={(e) =>
                projectRoot
                  ? setProjectModels(projectRoot, { provider: e.target.value })
                  : setFleetProvider(e.target.value)
              }
              style={inputStyle}
            >
              {Object.values(PROVIDERS).map((pr) => (
                <option key={pr.id} value={pr.id}>
                  {pr.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Dev fleet model" hint={`Override — blank uses ${effectiveProvider.name}'s default (${effectiveProvider.defaultModel})`}>
            <input
              value={projectRoot ? (projectModels.fleet ?? "") : fleetModel}
              onChange={(e) =>
                projectRoot
                  ? setProjectModels(projectRoot, { fleet: e.target.value })
                  : setFleetModel(e.target.value)
              }
              placeholder={effectiveProvider.defaultModel}
              style={inputStyle}
            />
          </Field>
```

Note: the closing checkbox `<label>` blocks and the rest of the Section (`:119` onward) are unchanged — this replacement stops right before them. The old `const provider = PROVIDERS[fleetProvider] ?? PROVIDERS.claude;` at `:54` is now superseded by `effectiveProvider` for the fleet-model hint; leave `:54` in place only if still referenced elsewhere in the file, otherwise remove it to avoid an unused-var lint. Verify with `grep -n "\bprovider\b" src/cadre/Settings.tsx` after editing and remove the `provider` const if it has no remaining uses.

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify tests + build**

Run: `npx vitest run`
Expected: PASS.

Run: `npm run build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src/cadre/Settings.tsx
git commit -m "feat(models): edit the active project's models in Settings (global default as fallback)"
```

---

### Task 7: Final verification + squash-free consolidation commit

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Full type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: PASS — 502 baseline + new tests (8 from Task 1 + 5 from Task 2 = 515 total, or the current baseline + 13). Record the exact printed count.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: success, no TS/bundler errors.

- [ ] **Step 4: Manual self-review checklist**

Confirm each:
- Dispatch/review/brownfield use the project's model + provider when `models` is set, else global (Task 3 — `grep -n "getProvider(get().fleetProvider)" src/cadre/useCadre.ts` returns nothing).
- The Execute screen (KanbanBoard + AgentOrgChart) shows no model dropdown (Task 5 grep returns nothing in those files).
- Editing models in Settings writes to `cadre.json` without clobbering `name`/`repos`/`tracker` (Task 2 `mergeModelsIntoManifest` tests prove this).
- Backward-compat: a `cadre.json` with no `models` key → `parseModels` returns `{}` → all resolvers fall back to global/default (Task 1 tests prove this).

- [ ] **Step 5: Final commit (spec-mandated message)**

If any prior task commits should be combined, the deliverable is that the branch ends with the spec's message. Create a final commit capturing any remaining staged work (or an empty marker commit is unnecessary — the last real commit should carry the message). Ensure the final commit on the branch uses:

```bash
git commit -m "$(cat <<'EOF'
feat(models): project-level model config in cadre.json; remove the Execute model picker

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CNZigNAixUkG5xTvMGxm6A
EOF
)"
```

Record the resulting commit hash for the report.

---

## Self-Review

**Spec coverage:**
1. Pure `models.ts` + `parseModels` + test → Task 1. ✓
2. `modelsStore.ts` + pure-helper test (`mergeModelsIntoManifest`) → Task 2. ✓
3. Project-aware resolution (`planningModel`/`fleetModelOverride` + provider at all sites) → Task 3. ✓
4. Load on open (CadreApp real path + demoMode) → Task 4. ✓
5. Remove Execute picker (both views, keep component in agentShared) → Task 5. ✓
6. Settings per-project models with global-default placeholders + no-project fallback → Task 6. ✓
7. Gates green + spec commit message → Task 7. ✓

**Placeholder scan:** No TBD/TODO/"add error handling" — every code step has full code.

**Type consistency:** `ProjectModels` (planning/fleet/provider) is used identically across Tasks 1-3, 6. `parseModels`, `mergeModelsIntoManifest`, `useModelsStore`, `fleetProviderId` names are stable across tasks. The four `getProvider(get().fleetProvider)` sites all become `getProvider(fleetProviderId())`.

**Note on the report deliverable:** the spec asks for a report at `/Users/alvin-reyes/Project/aride/.superpowers/sdd/project-models-report.md` with status, commit hash, one-line test summary, and concerns — write that after Task 7.
