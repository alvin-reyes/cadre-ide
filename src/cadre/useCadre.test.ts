/**
 * useCadre.test.ts — first batch of per-project mirror routing tests.
 *
 * SCOPE: Tauri-free store methods only.
 *   - setActiveProject seeds a slice + sets the mirror.
 *   - Public setters (setPrd, setPhase, setArchitecture) route to the ACTIVE
 *     project's slice; switching projects swaps the mirror AND restores prior values.
 *   - clearError routes to the active slice.
 *
 * NOTE on busy/error routing: busy and error have no public setter — they are set
 * internally by async actions that call Tauri. However, busy and error share the
 * IDENTICAL patchRoot+mirrorCadre path as prd/phase/architecture. The per-project
 * routing and restore-on-switch tests for prd/phase below transitively prove the
 * busy/error routing mechanism. The pure mirrorCadre tests in projectSlices.test.ts
 * verify that busy/error are copied correctly from the active slice.
 *
 * DEEP DISPATCH PIPELINE: tests that exercise dispatchStory/shardNextStory/etc. are
 * deferred — those methods compose many Tauri calls plus external stores
 * (bmadStore, settingsStore, secretGet, tauriOrchestratorDeps) making hermetic mocking
 * brittle for a first batch. A seam-extraction refactor (expose a testable deps
 * object similar to orchestrator.test.ts) is documented as the follow-up.
 *
 * @tauri-apps/api/core is mocked so the module-level `import { invoke }` in
 * useCadre.ts resolves without a Tauri runtime — none of the tests we run
 * actually call invoke, but the import must succeed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Tauri stub (must be declared before vi.mock factory runs) ---
const { invokeStub } = vi.hoisted(() => ({
  invokeStub: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeStub,
  Channel: class {
    onmessage: ((evt: unknown) => void) | null = null;
  },
}));

// Stub remaining stores and modules that useCadre imports so we don't pull in
// the full Tauri-dependent dependency tree.
vi.mock("../stores/bmadStore", () => ({
  useBmadStore: {
    getState: () => ({ projectRoot: null, stories: [], setStatus: vi.fn() }),
  },
}));
vi.mock("../stores/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({
      planningModel: "",
      fleetModel: "",
      anthropicApiKey: "",
      dispatchUseLogin: false,
      agentTimeoutMins: 0,
      resumeSessions: false,
      gateOnReview: false,
      autoResolveMerge: false,
      authProvider: "claude",
    }),
  },
}));
vi.mock("../stores/toastStore", () => ({ toast: vi.fn() }));
vi.mock("../stores/aiLogStore", () => ({ aiLog: vi.fn() }));
vi.mock("../lib/planning/planningChat", () => ({ callTool: vi.fn(), planningTurn: vi.fn() }));
vi.mock("../lib/planning/personas", () => ({
  ARCHITECT_SYSTEM_PROMPT: "",
  DESIGN_SYSTEM_PROMPT: "",
}));
vi.mock("../lib/planning/generateStory", () => ({ generateStory: vi.fn() }));
vi.mock("../lib/engine/orchestrator", () => ({ runApprovedStory: vi.fn() }));
vi.mock("../lib/engine/reviewFleet", () => ({
  reviewStory: vi.fn(),
  aggregateReviews: vi.fn(),
}));
vi.mock("../lib/engine/brownfield", () => ({
  documentProject: vi.fn(),
  BROWNFIELD_DOC_PATH: "docs/brownfield.md",
}));
vi.mock("../lib/planning/review", () => ({ CODE_REVIEW_LENSES: [] }));
vi.mock("../lib/engine/tauriDeps", () => ({
  tauriOrchestratorDeps: vi.fn(() => ({})),
  tauriReviewFleetDeps: vi.fn(() => ({})),
  tauriResolveConflictDeps: vi.fn(() => ({})),
}));
vi.mock("../lib/engine/dispatch", () => ({
  composeDispatchPrompt: vi.fn(),
  storyBranch: vi.fn(),
}));
vi.mock("../lib/engine/resolveConflict", () => ({
  resolveMergeConflict: vi.fn(),
  composeResolverPrompt: vi.fn(),
}));
vi.mock("../lib/reportError", () => ({ reportError: vi.fn() }));
vi.mock("../lib/engine/sessionLog", () => ({
  appendSessionEntry: vi.fn(),
  SESSION_LOG_PATH: ".cadre/session.md",
}));
vi.mock("../lib/engine/agentSessions", () => ({ resolveStorySession: vi.fn() }));
vi.mock("../lib/engine/shard", () => ({
  nextStoryNumber: vi.fn(),
  parseStoryFiles: vi.fn(() => []),
  parseStoryRepo: vi.fn(() => "main"),
  shardStory: vi.fn(),
}));
vi.mock("../lib/engine/repos", () => ({
  parseRepos: vi.fn(() => [{ id: "main", path: "." }]),
  resolveRepoPath: vi.fn((root: string) => root),
  findRepo: vi.fn((repos: unknown[], _id: string) => (repos as { id: string; path: string }[])[0] ?? { id: "main", path: "." }),
}));
vi.mock("../lib/planning/storyTool", () => ({
  CREATE_BACKLOG_TOOL: {},
  backlogFromTool: vi.fn(() => []),
}));
vi.mock("../lib/engine/schedule", () => ({ scheduleParallel: vi.fn(() => []) }));
vi.mock("../lib/engine/detectVerify", () => ({ detectVerifyCommand: vi.fn(() => "") }));
vi.mock("../lib/engine/integrate", () => ({ integrateStory: vi.fn() }));
vi.mock("../lib/engine/providers", () => ({
  getProvider: vi.fn(() => ({ id: "claude", name: "Claude", secretKey: "ANTHROPIC_API_KEY", defaultModel: "claude-opus-4-8" })),
  resolveAgentEnv: vi.fn(() => ({ env: {}, model: undefined })),
}));
vi.mock("../lib/secrets", () => ({ secretGet: vi.fn().mockResolvedValue(null) }));
vi.mock("../lib/planning/planningAuth", () => ({
  resolvePlanningAuth: vi.fn().mockResolvedValue({ ready: false, reason: "no key", apiKey: null, baseUrl: undefined }),
}));

// --- Store under test ---
import { useCadre } from "./useCadre";
import { emptyCadreSlice } from "../lib/engine/projectSlices";

// --- Helpers ---

/** Full hermetic reset: no projects, no active root, mirror at empty defaults. */
function resetStore() {
  const empty = emptyCadreSlice();
  useCadre.setState({
    projects: {},
    activeRoot: null,
    phase: empty.phase,
    prd: empty.prd,
    architecture: empty.architecture,
    analystBrief: empty.analystBrief,
    techDocs: empty.techDocs,
    uxSpec: empty.uxSpec,
    mockupHtml: empty.mockupHtml,
    poValidation: empty.poValidation,
    projectContext: empty.projectContext,
    isBrownfield: empty.isBrownfield,
    detectedVerify: empty.detectedVerify,
    verification: empty.verification,
    needsReplan: empty.needsReplan,
    logs: empty.logs,
    codeReviews: empty.codeReviews,
    active: empty.active,
    busy: empty.busy,
    error: empty.error,
    fleetProvider: "claude",
  });
}

beforeEach(() => {
  resetStore();
  invokeStub.mockClear();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. setActiveProject — seeding and mirror derivation
// ─────────────────────────────────────────────────────────────────────────────

describe("setActiveProject", () => {
  it("seeds an empty slice on first activation", () => {
    useCadre.getState().setActiveProject("/a");
    const state = useCadre.getState();
    expect(state.activeRoot).toBe("/a");
    expect(state.projects["/a"]).toBeDefined();
    expect(state.projects["/a"].prd).toBe("");
    expect(state.projects["/a"].busy).toBeNull();
    expect(state.projects["/a"].error).toBeNull();
  });

  it("sets the mirror to the new project's slice immediately after switch", () => {
    useCadre.getState().setActiveProject("/a");
    // Mirror should reflect /a's empty slice.
    expect(useCadre.getState().prd).toBe("");
    expect(useCadre.getState().phase).toBe("PLAN");
  });

  it("preserves an existing slice when re-activating a project", () => {
    useCadre.getState().setActiveProject("/a");
    useCadre.getState().setPrd("existing PRD");
    // Switch away then back.
    useCadre.getState().setActiveProject("/b");
    useCadre.getState().setActiveProject("/a");
    expect(useCadre.getState().projects["/a"].prd).toBe("existing PRD");
  });

  it("can open two independent projects without interference", () => {
    useCadre.getState().setActiveProject("/a");
    useCadre.getState().setActiveProject("/b");
    const state = useCadre.getState();
    expect(state.projects["/a"]).toBeDefined();
    expect(state.projects["/b"]).toBeDefined();
    expect(state.activeRoot).toBe("/b");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Per-project routing — setPrd
// ─────────────────────────────────────────────────────────────────────────────

describe("setPrd — per-project routing", () => {
  it("routes setPrd to the active project's slice", () => {
    useCadre.getState().setActiveProject("/a");
    useCadre.getState().setPrd("A's PRD");

    expect(useCadre.getState().projects["/a"].prd).toBe("A's PRD");
    expect(useCadre.getState().prd).toBe("A's PRD"); // mirror updated
  });

  it("does not write to an inactive project's slice", () => {
    useCadre.getState().setActiveProject("/a");
    useCadre.getState().setActiveProject("/b");
    useCadre.getState().setPrd("B's PRD");

    // /a must be untouched.
    expect(useCadre.getState().projects["/a"].prd).toBe("");
    expect(useCadre.getState().projects["/b"].prd).toBe("B's PRD");
  });

  it("restores /a's prd when switching back from /b (no leak between projects)", () => {
    // Open /a, write "A".
    useCadre.getState().setActiveProject("/a");
    useCadre.getState().setPrd("A");
    expect(useCadre.getState().prd).toBe("A");

    // Switch to /b — mirror should reflect /b's empty slice.
    useCadre.getState().setActiveProject("/b");
    expect(useCadre.getState().prd).toBe(""); // /b is fresh

    // Write to /b.
    useCadre.getState().setPrd("B");
    expect(useCadre.getState().prd).toBe("B");

    // Switch back to /a — mirror must restore "A", not remain at "B".
    useCadre.getState().setActiveProject("/a");
    expect(useCadre.getState().prd).toBe("A");

    // Underlying slices are independent.
    expect(useCadre.getState().projects["/a"].prd).toBe("A");
    expect(useCadre.getState().projects["/b"].prd).toBe("B");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Per-project routing — setPhase
// ─────────────────────────────────────────────────────────────────────────────

describe("setPhase — per-project routing", () => {
  it("routes setPhase to the active project's slice", () => {
    useCadre.getState().setActiveProject("/a");
    useCadre.getState().setPhase("SHARD");

    expect(useCadre.getState().projects["/a"].phase).toBe("SHARD");
    expect(useCadre.getState().phase).toBe("SHARD");
  });

  it("restores /a's phase when switching back from /b", () => {
    useCadre.getState().setActiveProject("/a");
    useCadre.getState().setPhase("FLEET");

    useCadre.getState().setActiveProject("/b");
    expect(useCadre.getState().phase).toBe("PLAN"); // /b starts at PLAN

    useCadre.getState().setPhase("SHARD");
    useCadre.getState().setActiveProject("/a");

    expect(useCadre.getState().phase).toBe("FLEET"); // /a's value restored
    expect(useCadre.getState().projects["/b"].phase).toBe("SHARD");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Per-project routing — setArchitecture
// ─────────────────────────────────────────────────────────────────────────────

describe("setArchitecture — per-project routing", () => {
  it("restores /a's architecture when switching back from /b", () => {
    useCadre.getState().setActiveProject("/a");
    useCadre.getState().setArchitecture("arch-A");

    useCadre.getState().setActiveProject("/b");
    expect(useCadre.getState().architecture).toBe("");

    useCadre.getState().setArchitecture("arch-B");
    useCadre.getState().setActiveProject("/a");

    expect(useCadre.getState().architecture).toBe("arch-A");
    expect(useCadre.getState().projects["/b"].architecture).toBe("arch-B");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. clearError — routes to active slice
// ─────────────────────────────────────────────────────────────────────────────

describe("clearError — per-project routing", () => {
  it("clears only the active project's error, not an inactive project's", () => {
    // Seed /a's slice with an error by direct slice mutation (no public setter;
    // we use setState on projects only — NOT bypassing patchRoot semantics, just
    // pre-loading a known slice state so clearError has something to clear).
    useCadre.getState().setActiveProject("/a");
    useCadre.getState().setActiveProject("/b");

    // Inject errors into both slices via setState on the projects map directly.
    useCadre.setState((s) => ({
      projects: {
        ...s.projects,
        "/a": { ...s.projects["/a"], error: "err-A" },
        "/b": { ...s.projects["/b"], error: "err-B" },
      },
    }));

    // Activate /b and clear its error.
    useCadre.getState().setActiveProject("/b");
    useCadre.getState().clearError();

    const state = useCadre.getState();
    expect(state.projects["/b"].error).toBeNull();  // cleared
    expect(state.projects["/a"].error).toBe("err-A"); // untouched
    expect(state.error).toBeNull(); // mirror reflects /b
  });

  it("is a no-op when no project is active", () => {
    // No active project — should not throw.
    expect(() => useCadre.getState().clearError()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. busy/error routing (via mirrorCadre mechanism, transitively proven)
// ─────────────────────────────────────────────────────────────────────────────

describe("busy/error mirror routing — transitively proven via prd/phase path", () => {
  /**
   * busy and error are written by async actions via patchRoot(root, { busy, error })
   * which calls updateSlice then syncCadreMirror — the SAME two-step path that
   * setPrd/setPhase use. The per-project routing + restore-on-switch tests above
   * (§2–§4) fully exercise that path. Additionally, mirrorCadre correctly copies
   * busy/error from the active slice (proven in projectSlices.test.ts §mirrorCadre).
   *
   * This test seeds busy/error into two slices and asserts that switching the active
   * project swaps the mirror's busy/error fields — closing the integration gap.
   */
  it("swaps busy and error in the mirror when the active project changes", () => {
    useCadre.getState().setActiveProject("/a");
    useCadre.getState().setActiveProject("/b");

    // Inject known busy/error values into both slices.
    useCadre.setState((s) => ({
      projects: {
        ...s.projects,
        "/a": { ...s.projects["/a"], busy: "running-A", error: "err-A" },
        "/b": { ...s.projects["/b"], busy: "running-B", error: null },
      },
    }));

    // Activate /a — mirror should reflect /a's busy/error.
    useCadre.getState().setActiveProject("/a");
    expect(useCadre.getState().busy).toBe("running-A");
    expect(useCadre.getState().error).toBe("err-A");

    // Switch to /b — mirror should reflect /b's busy/error.
    useCadre.getState().setActiveProject("/b");
    expect(useCadre.getState().busy).toBe("running-B");
    expect(useCadre.getState().error).toBeNull();
  });
});
