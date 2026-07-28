import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Phase } from "./components/PhaseStepper";
import { useBmadStore } from "../stores/bmadStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useModelsStore } from "../stores/modelsStore";
import { toast } from "../stores/toastStore";
import { aiLog } from "../stores/aiLogStore";
import { callTool, planningTurn } from "../lib/planning/planningChat";
import { ARCHITECT_SYSTEM_PROMPT, DESIGN_SYSTEM_PROMPT } from "../lib/planning/personas";
import { generateStory } from "../lib/planning/generateStory";
import { runApprovedStory } from "../lib/engine/orchestrator";
import { reviewStory as reviewStoryFleet, aggregateReviews, type LensReview } from "../lib/engine/reviewFleet";
import { documentAllRepos, composeAggregateAnalysis, BROWNFIELD_DOC_PATH } from "../lib/engine/brownfield";
import { CODE_REVIEW_LENSES } from "../lib/planning/review";
import { tauriOrchestratorDeps, tauriReviewFleetDeps, tauriResolveConflictDeps } from "../lib/engine/tauriDeps";
import { composeDispatchPrompt, storyBranch, type AlwaysFile } from "../lib/engine/dispatch";
import { ADR_DECISIONS_DIR } from "../lib/engine/adr";
import { resolveMergeConflict, composeResolverPrompt } from "../lib/engine/resolveConflict";
import { reportError } from "../lib/reportError";
import { appendSessionEntry, SESSION_LOG_PATH } from "../lib/engine/sessionLog";
import { resolveStorySession } from "../lib/engine/agentSessions";
import { nextStoryNumber, parseStoryFiles, parseStoryRepo, shardStory } from "../lib/engine/shard";
import { parseRepos, resolveRepoPath, findRepo, DEFAULT_REPO_ID } from "../lib/engine/repos";
import type { ProjectMode } from "../lib/engine/projectMode";
import { makeTask, setTaskStatus, type MaintainTask } from "../lib/maintain/tasks";
import { runMaintainTask } from "../lib/maintain/dispatchOrchestration";
import { useRepos } from "../stores/reposStore";
import { CREATE_BACKLOG_TOOL, backlogFromTool } from "../lib/planning/storyTool";
import { composeRoster, QA_AGENT_ID, DEVOPS_AGENT_ID } from "../lib/engine/agentSlots";
import { detectVerifyCommand } from "../lib/engine/detectVerify";
import { storyRole } from "../lib/engine/kanban";
import { pickAssignable, partitionByRole, type ReadyStory } from "../lib/engine/pool";
import { integrateStory } from "../lib/engine/integrate";
import { getProvider, resolveAgentEnv, type Provider } from "../lib/engine/providers";
import { secretGet } from "../lib/secrets";
import { resolvePlanningAuth } from "../lib/planning/planningAuth";
import type { Status } from "../lib/engine/status";
import type { PlanApproval } from "../lib/engine/planApproval";
import {
  emptyCadreSlice,
  mirrorCadre,
  updateSlice,
  type AgentSlot,
  type CadreSlice,
} from "../lib/engine/projectSlices";
import { resolveAgentSession } from "../lib/engine/teamSessions";

/**
 * useCadre: the app-level orchestration seam. It holds the plan the Planning
 * Studio produces (prd/architecture), then drives the disciplined loop by
 * calling the engine + Tauri bindings — approve the plan (freeze the
 * verification command), shard a story with the SM, and dispatch a Dev agent
 * that Cadre verifies. The pure engine logic stays in src/lib; this is the glue
 * the UI phase calls.
 */

// The planning brain (PM/Architect/Designer chat, SM sharding, plan validation,
// and the SDK adversarial reviews) runs on Opus — quality where it matters, low
// volume. The dev fleet stays on Sonnet (providers.claude.defaultModel).
// MODEL is the default; Settings can override it (planningModel / fleetModel).
export const MODEL = "claude-opus-4-8";

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

/**
 * A story is "interrupted" when the board shows it mid-flight (InProgress or
 * InReview) but Cadre isn't actually running it this session — the agent was a
 * child of a prior app process and died with it. Re-dispatching is safe: dispatch
 * is idempotent (it prunes the stale worktree/branch and re-runs clean from HEAD).
 */
export function isInterrupted(status: string, active: Record<string, boolean>, epic: number, story: number): boolean {
  return (status === "InProgress" || status === "InReview") && !active[`${epic}.${story}`];
}

const SM_SYSTEM_PROMPT = `You are the Scrum Master (SM). Turn the approved plan into the NEXT single implementation story via the create_story tool.

Prefer a small, vertically-sliced, independently testable story. Populate every field completely — the Dev agent works only from this story and reads nothing else, so put the relevant architecture, file paths, and standards into devNotes. Acceptance criteria must be concrete and testable; tasks must be TDD-first (write the failing test, then the code).

Declare the exact repo-relative \`files\` this story will create or modify, and keep stories FILE-DISJOINT from one another — Cadre runs file-disjoint stories as parallel agents, and any file two stories share forces them to run sequentially. Slice the work so parallel stories don't touch the same files.

Think across every LAYER (frontend/UI, backend/API, database) and the WHOLE lifecycle (setup, DevOps/CI-CD/deployment, tests, QA/acceptance testing, integration, monitoring, documentation, support) — not just backend features. A backlog that is backend-only, or missing the frontend, database, QA, or deployment work, is incomplete.

Every story MUST include an extensive Definition of Done — a thorough, checkable list (acceptance criteria met and test-covered, edge cases, no regressions, docs, and the frozen verification command green). A story without a real DoD is incomplete.`;

const DEV_SYSTEM_PROMPT = `You are the Dev agent. Implement the assigned story test-first: write the failing test, then the minimal code to make it pass. Follow the project's standards. Do NOT mark the story done — Cadre runs the verification command and decides.

SHARED CONTEXT: other stories build in parallel with you. If you create or change something other stories must agree on — a shared interface, type, API contract, config key, or an important decision — record it in a short Markdown file under \`.cadre/context/\` (e.g. \`.cadre/context/auth-api.md\`). Keep those files small and factual. Before inventing a shared contract, check what's already in \`.cadre/context/\` and reuse it. This is how parallel and later agents stay consistent.

DECISION MEMORY (ADRs): significant architectural or cross-cutting decisions — a technology, pattern, contract, or trade-off other stories depend on — are recorded as Architecture Decision Records under \`.cadre/context/decisions/NNNN-slug.md\`, each with \`## Status\` (Accepted), \`## Context\`, \`## Decision\`, and \`## Consequences\`. Before diverging from an existing decision, READ the ADRs already in \`.cadre/context/decisions/\` and follow them — do not silently re-decide. When you make such a decision, add a new ADR (next number) so later agents inherit it.`;

interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

/** The relative path a document lives at under the project root. */
const PRD_PATH = "docs/prd.md";
const ARCH_PATH = "docs/architecture.md";
const UX_PATH = "docs/ux-spec.md";
const MOCKUP_PATH = "docs/mockup.html";
const PO_PATH = "docs/po-validation.md";
const BRIEF_PATH = "docs/brief.md";
const TECHDOCS_PATH = "docs/documentation.md";
const OPS_PATH = "docs/ops.md";

/** Byte budget for ADRs inlined into a dispatched agent's prompt (the decision
 *  log is append-only and unbounded; newest ADRs win, the rest are summarized). */
const ADR_INJECT_BUDGET_BYTES = 24_000;

/** Byte budget for the brownfield analysis inlined into a dispatched agent's prompt
 *  (a multi-repo aggregate can be large; the full doc stays on disk). */
const BROWNFIELD_INJECT_BUDGET_BYTES = 16_000;

interface CadreState {
  // --- per-project map (Task 5) ---
  /** every open project's fleet state, keyed by root */
  projects: Record<string, CadreSlice>;
  /** the foreground project; the top-level fields below mirror projects[activeRoot] */
  activeRoot: string | null;
  // --- mirror fields (derived from projects[activeRoot]) ---
  phase: Phase;
  /** the planning artifacts, as they form in the Planning Studio */
  prd: string;
  architecture: string;
  /** optional Analyst brief (discovery) and Technical Writer documentation */
  analystBrief: string;
  techDocs: string;
  /** optional DevOps / Release Engineer ops plan */
  opsDoc: string;
  /** optional UX/design artifacts (Design tab) — spec + a live HTML mockup */
  uxSpec: string;
  mockupHtml: string;
  /** optional PO validation report (PO tab) — sign-off / gaps vs the PRD */
  poValidation: string;
  /** brownfield analysis of an existing project (grounds the PM), if generated */
  projectContext: string;
  /** true when the opened project has existing code but no Cadre plan yet */
  isBrownfield: boolean;
  /** true only while the brownfield analysis agent runs (drives the onboard spinner) */
  analyzingBrownfield: boolean;
  /** verify command auto-detected from the project's manifests ("" = none) */
  detectedVerify: string;
  /** the frozen verification command(s) once the plan is approved */
  verification: string[];
  /** true when the PRD/plan changed after approval — the fleet must re-approve (§5.1) */
  needsReplan: boolean;
  /** live agent + verification output, keyed by "epic.story" (streamed on dispatch) */
  logs: Record<string, string>;
  /** adversarial code-review results keyed by "epic.story" (the review fleet) */
  codeReviews: Record<string, { status: "reviewing" | "done"; reviews?: LensReview[] }>;
  /**
   * Stories with a live dispatch/verify running THIS session, keyed "epic.story".
   * Used to tell a genuinely-running story from an orphaned one: an InProgress /
   * InReview story that is NOT active was interrupted (its agent died with a prior
   * session — the process is a child of the app). See `isInterrupted`.
   */
  active: Record<string, boolean>;
  /** Persistent role-fleet agent slots (QA, DevOps, Dev-N). */
  agentSlots: AgentSlot[];
  /** Per-agent accumulated output log, keyed by agentId. */
  agentLogs: Record<string, string>;
  /** which model provider the Dev fleet runs on (id from engine PROVIDERS) */
  fleetProvider: string;
  /**
   * A human-readable status while an async action runs for the active project
   * (null = idle). Mirror-derived: reflects projects[activeRoot].busy.
   */
  busy: string | null;
  /**
   * Last error message for the active project (null = none).
   * Mirror-derived: reflects projects[activeRoot].error.
   */
  error: string | null;
  /** Build (greenfield plan/shard/dispatch) vs Maintain (existing app, ad-hoc tasks). */
  mode: ProjectMode;
  /** True right after opening a project until the user picks Build vs Maintain. */
  modeChoicePending: boolean;
  /** Maintenance/support tasks dispatched for the active project. */
  tasks: MaintainTask[];

  setPhase: (phase: Phase) => void;
  setPrd: (md: string) => void;
  setArchitecture: (md: string) => void;
  setUxSpec: (md: string) => void;
  setAnalystBrief: (md: string) => void;
  setTechDocs: (md: string) => void;
  setOpsDoc: (md: string) => void;
  setMockupHtml: (html: string) => void;
  setPoValidation: (md: string) => void;
  setFleetProvider: (id: string) => void;
  clearError: () => void;
  /** Switch the foreground project; re-derives the mirror from that project's slice. */
  setActiveProject: (root: string) => void;
  /** Mark the active project's plan as needing re-approval (e.g. after registry change). */
  markNeedsReplan: () => void;
  /** Set the active project's mode (Build vs Maintain). */
  setMode: (mode: ProjectMode) => void;
  /** Open-time: set the suggested mode and mark the choice pending (shows the picker). */
  requestModeChoice: (suggested: ProjectMode) => void;
  /** The user picked a mode: set it and clear the pending picker. */
  chooseMode: (mode: ProjectMode) => void;
  /** Mint + queue a maintenance task, then dispatch it (worktree + agent spawn). */
  addMaintainTask: (prompt: string) => Promise<void>;

  /** Freeze the verification command, write the plan to disk, unlock the fleet. */
  approvePlan: (verification: string[]) => Promise<void>;
  /** Run the SM to shard the next story for `epic` (default 1) in the given `repoId` (default main). */
  shardNextStory: (epic?: number, repoId?: string) => Promise<void>;
  /** Run the SM to shard the COMPLETE lifecycle backlog (features + tests + deploy + support…). */
  shardBacklog: (epic?: number) => Promise<void>;
  /** Dispatch a Dev agent for a story; Cadre verifies and writes the status. */
  dispatchStory: (epic: number, story: number, opts?: { silent?: boolean; context?: AlwaysFile[]; agentId?: string }) => Promise<void>;
  /**
   * Dispatch ALL ready stories in parallel, grouped so no two concurrent agents
   * touch the same declared file (disjoint sharding); file-sharing stories run in
   * later batches. Every agent gets the shared Context Store injected.
   */
  dispatchReady: () => Promise<void>;
  /** Gate a sharded story for the fleet: Draft → Approved (the SM/CTO review step). */
  approveStory: (epic: number, story: number) => Promise<void>;
  /** Run the adversarial code-review fleet (diverse-lens agent loops) on a story. */
  reviewStory: (epic: number, story: number, root?: string, repoId?: string) => Promise<void>;
  /** Brownfield onboarding: a PM/Analyst agent documents an existing project (twice). */
  documentProject: () => Promise<void>;
  /** Read a story's markdown (docs/stories/{epic}.{story}.*.md), or "" if none. */
  getStoryMarkdown: (epic: number, story: number) => Promise<string>;
  /** Reload the plan (prd/architecture), frozen verification, and phase from disk (§3.8). */
  hydrateFromProject: () => Promise<void>;
  /**
   * Automatic downstream cascade after a scope change (§5.1): re-run the Architect
   * (and Designer if a UX spec exists) to update the plan from the amended PRD, then
   * shard a story for the new scope. Leaves the plan needing human re-approval.
   */
  cascadeReplan: () => Promise<void>;
}

/** Locate a story file by its {epic}.{story} prefix under docs/stories. */
async function findStoryPath(root: string, epic: number, story: number): Promise<string | null> {
  const entries = await invoke<DirEntry[]>("list_directory", { path: `${root}/docs/stories` });
  const prefix = `${epic}.${story}.`;
  return entries.find((e) => !e.is_dir && basename(e.path).startsWith(prefix))?.path ?? null;
}

/**
 * Resolve the per-agent env + model for the fleet provider. Native Claude can run
 * on the user's claude.ai CLI login (no API key in env) when dispatchUseLogin is on;
 * otherwise it needs a key. Centralized so dispatch/review/brownfield agree.
 */
async function resolveFleetAuth(provider: Provider): Promise<{ env: Record<string, string>; model: string | undefined }> {
  if (provider.id === "claude" && useSettingsStore.getState().dispatchUseLogin) {
    return { env: {}, model: undefined };
  }
  let token = await secretGet(provider.secretKey);
  if (!token && provider.id === "claude") {
    token = useSettingsStore.getState().anthropicApiKey || null;
  }
  if (!token) throw new Error(`No API key for ${provider.name} — add it in Settings.`);
  const { env, model: providerModel } = resolveAgentEnv(provider, token, fleetModelOverride() || provider.defaultModel);
  // Native Claude CLI uses its own default model (an unknown --model id can fail).
  return { env, model: provider.id === "claude" ? undefined : providerModel };
}

/** The agent timeout (seconds) from settings; 0 = no cap. */
function agentTimeoutSecs(): number {
  return Math.max(0, (useSettingsStore.getState().agentTimeoutMins || 0) * 60);
}

/** Read the project's manifests to auto-detect its test/verify command ("" if none). */
async function detectProjectVerify(root: string): Promise<string> {
  const read = (rel: string) =>
    invoke<string>("read_file", { path: `${root}/${rel}` }).then((c) => c, () => undefined);
  const has = (rel: string) =>
    invoke<string>("read_file", { path: `${root}/${rel}` }).then(() => true, () => false);
  const [packageJson, cargoToml, goMod, pyproject, makefile, pnpmLock, yarnLock, bunLock] = await Promise.all([
    read("package.json"),
    read("Cargo.toml"),
    read("go.mod"),
    read("pyproject.toml"),
    read("Makefile"),
    has("pnpm-lock.yaml"),
    has("yarn.lock"),
    has("bun.lockb"),
  ]);
  return detectVerifyCommand({ packageJson, cargoToml, goMod, pyproject, makefile, pnpmLock, yarnLock, bunLock }) ?? "";
}

/** Read the project's cadre.json manifest (returns "" when absent — single-repo compat). */
async function readManifest(root: string): Promise<string> {
  return invoke<string>("read_file", { path: `${root}/cadre.json` }).catch(() => "");
}

/**
 * The shared Context Store injected into every Dev agent: the architecture (the
 * common interfaces/decisions) plus any committed `.cadre/context/*.md`. Ensures
 * parallel agents build against the same contract instead of diverging.
 */
async function loadSharedContext(root: string): Promise<AlwaysFile[]> {
  // Only the (small, incremental) Context Store is inlined into every agent — the
  // relevant architecture already lives in each story's dev notes. Inlining the
  // whole architecture.md here bloated the `claude -p "<prompt>"` argv and could
  // fail the spawn outright.
  const files: AlwaysFile[] = [];
  // The session journal — what's already been planned/built/shipped — so a fresh
  // subagent knows what's happening across the fleet, not just its own story.
  const journal = await invoke<string>("read_file", { path: `${root}/${SESSION_LOG_PATH}` }).catch(() => "");
  if (journal.trim()) files.push({ path: SESSION_LOG_PATH, content: journal });
  try {
    const entries = await invoke<DirEntry[]>("list_directory", { path: `${root}/.cadre/context` });
    for (const e of entries) {
      if (e.is_dir || !e.name.endsWith(".md")) continue;
      const c = await invoke<string>("read_file", { path: e.path }).catch(() => "");
      if (c.trim()) files.push({ path: `.cadre/context/${e.name}`, content: c });
    }
  } catch {
    /* no Context Store yet */
  }
  // ADRs (durable decision records) live in a subdir of the Context Store. Inject
  // them too so every agent consults prior decisions before re-deciding. Tolerant
  // of absence — a project with no decisions/ dir behaves exactly as before.
  //
  // The decision log is append-only and grows for the life of a project, so bound
  // what we inline into the `claude -p` argv: newest ADRs first, up to a byte
  // budget. If any are dropped, say so explicitly rather than silently truncating.
  try {
    const decisions = await invoke<DirEntry[]>("list_directory", { path: `${root}/${ADR_DECISIONS_DIR}` });
    const mdFiles = decisions
      .filter((e) => !e.is_dir && e.name.endsWith(".md"))
      .sort((a, b) => b.name.localeCompare(a.name)); // zero-padded NNNN- prefix → newest first
    let used = 0;
    let injected = 0;
    for (const e of mdFiles) {
      const c = await invoke<string>("read_file", { path: e.path }).catch(() => "");
      if (!c.trim()) continue;
      // Always inject at least the newest ADR; stop once the budget is exceeded.
      if (used + c.length > ADR_INJECT_BUDGET_BYTES && injected > 0) break;
      files.push({ path: `${ADR_DECISIONS_DIR}/${e.name}`, content: c });
      used += c.length;
      injected += 1;
    }
    const omitted = mdFiles.length - injected;
    if (omitted > 0) {
      files.push({
        path: `${ADR_DECISIONS_DIR}/_index.md`,
        content: `# Decision log (truncated)\n\nThe ${injected} most-recent ADR(s) are inlined above; ${omitted} older ADR(s) were omitted to bound prompt size. Read \`${ADR_DECISIONS_DIR}/\` directly for the full history before diverging from a settled decision.`,
      });
    }
  } catch {
    /* no decisions yet */
  }
  // Brownfield: the as-is analysis (the structured architecture/stack/risk summary)
  // so a Dev agent working existing code sees the high-level map, not just its story.
  // Bound it — a multi-repo aggregate can be large and rides every agent's argv.
  const brownfield = await invoke<string>("read_file", { path: `${root}/${BROWNFIELD_DOC_PATH}` }).catch(() => "");
  if (brownfield.trim()) {
    const capped =
      brownfield.length > BROWNFIELD_INJECT_BUDGET_BYTES
        ? brownfield.slice(0, BROWNFIELD_INJECT_BUDGET_BYTES) +
          `\n\n…(analysis truncated for prompt size — read \`${BROWNFIELD_DOC_PATH}\` in full for the complete picture)`
        : brownfield;
    files.push({ path: BROWNFIELD_DOC_PATH, content: capped });
  }
  return files;
}

/**
 * Append one event to the persisted session journal (`.cadre/session.md`). Best-effort:
 * journaling must never break a dispatch, so failures are swallowed. Also mirrored to
 * the in-memory AI log so it shows live.
 */
async function logSession(root: string, event: string): Promise<void> {
  try {
    await appendSessionEntry(
      {
        readFile: (p) => invoke<string>("read_file", { path: p }),
        writeFile: (p, c) => invoke("write_text_file", { path: p, content: c }).then(() => {}),
      },
      root,
      Date.now(),
      event
    );
    aiLog("session", event);
  } catch {
    /* journaling is best-effort */
  }
}

// Merges into main mutate the shared root worktree, so they must run one at a
// time even when many stories finish in parallel. This chains them.
let mergeChain: Promise<unknown> = Promise.resolve();
function withMergeLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = mergeChain.then(fn, fn);
  mergeChain = run.catch(() => {});
  return run;
}

function requireRoot(): string {
  const root = useBmadStore.getState().projectRoot;
  if (!root) {
    throw new Error("Open a project first — sharding and dispatch need a project on disk.");
  }
  return root;
}

/**
 * Resolve the planning credential from the settings-selected provider.
 * Non-Anthropic keys live only in the keychain, so we always read via secretGet.
 * Returns a PlanningAuth with { apiKey, baseUrl, ready, reason }.
 */
async function getPlanningAuth() {
  const s = useSettingsStore.getState();
  return resolvePlanningAuth(s.authProvider, s.dispatchUseLogin, secretGet);
}

export const useCadre = create<CadreState>((set, get) => {
  // Re-derive the active mirror from the projects map. Call after every slice change.
  function syncCadreMirror() {
    set((s) => mirrorCadre(s.projects, s.activeRoot));
  }

  // Apply a patch to a SPECIFIC root's slice, then mirror if that root is active.
  // Long-running actions MUST pass the root they captured at the top (requireRoot),
  // NOT get().activeRoot — the user may switch projects mid-dispatch, and a
  // background write to "active" would corrupt the foreground project's slice.
  function patchRoot(root: string, patch: Partial<CadreSlice>) {
    set((s) => ({ projects: updateSlice(s.projects, root, patch, emptyCadreSlice) }));
    if (get().activeRoot === root) syncCadreMirror();
  }

  return {
  // --- per-project map ---
  projects: {},
  activeRoot: null,
  // --- mirror (initial = empty slice defaults) ---
  phase: "PLAN",
  prd: "",
  architecture: "",
  uxSpec: "",
  analystBrief: "",
  techDocs: "",
  opsDoc: "",
  mockupHtml: "",
  poValidation: "",
  projectContext: "",
  isBrownfield: false,
  analyzingBrownfield: false,
  detectedVerify: "",
  verification: [],
  needsReplan: false,
  logs: {},
  codeReviews: {},
  active: {},
  agentSlots: [],
  agentLogs: {},
  // --- global (not per-project) ---
  fleetProvider: "claude",
  // busy/error are mirror fields; initialize from emptyCadreSlice defaults.
  busy: null,
  error: null,
  mode: "build",
  modeChoicePending: false,
  tasks: [],

  setActiveProject: (root) => {
    // Seed an empty slice on first activation so the mirror is stable.
    set((s) => ({
      projects: s.projects[root] ? s.projects : { ...s.projects, [root]: emptyCadreSlice() },
      activeRoot: root,
    }));
    syncCadreMirror();
  },

  setPhase: (phase) => {
    const root = get().activeRoot;
    if (root) patchRoot(root, { phase });
  },
  // Editing a plan artifact after approval marks the plan as needing re-approval.
  setPrd: (prd) => {
    const root = get().activeRoot;
    if (root) patchRoot(root, { prd, needsReplan: get().verification.length > 0 ? true : get().needsReplan });
  },
  setArchitecture: (architecture) => {
    const root = get().activeRoot;
    if (root) patchRoot(root, { architecture, needsReplan: get().verification.length > 0 ? true : get().needsReplan });
  },
  setUxSpec: (uxSpec) => {
    const root = get().activeRoot;
    if (root) patchRoot(root, { uxSpec, needsReplan: get().verification.length > 0 ? true : get().needsReplan });
  },
  setAnalystBrief: (analystBrief) => {
    const root = get().activeRoot;
    if (root) patchRoot(root, { analystBrief });
  },
  setTechDocs: (techDocs) => {
    const root = get().activeRoot;
    if (root) patchRoot(root, { techDocs });
  },
  setOpsDoc: (opsDoc) => {
    const root = get().activeRoot;
    if (root) patchRoot(root, { opsDoc });
  },
  setMockupHtml: (mockupHtml) => {
    const root = get().activeRoot;
    if (root) patchRoot(root, { mockupHtml });
  },
  setPoValidation: (poValidation) => {
    const root = get().activeRoot;
    if (root) patchRoot(root, { poValidation });
  },
  setFleetProvider: (fleetProvider) => set({ fleetProvider }),
  clearError: () => {
    const root = get().activeRoot;
    if (root) patchRoot(root, { error: null });
  },
  markNeedsReplan: () => {
    const root = get().activeRoot;
    if (root && get().verification.length > 0) patchRoot(root, { needsReplan: true });
  },
  setMode: (mode) => {
    const root = get().activeRoot;
    if (root) patchRoot(root, { mode });
  },
  requestModeChoice: (suggested) => {
    const root = get().activeRoot;
    if (root) patchRoot(root, { mode: suggested, modeChoicePending: true });
  },
  chooseMode: (mode) => {
    const root = get().activeRoot;
    if (root) patchRoot(root, { mode, modeChoicePending: false });
  },
  addMaintainTask: async (prompt) => {
    const root = requireRoot();
    const id = Math.random().toString(36).slice(2, 8); // slice-1 id; replace with a Tauri uuid later
    const task = makeTask(id, prompt, Date.now());
    patchRoot(root, { tasks: [task, ...(get().projects[root]?.tasks ?? [])] });
    const repos = parseRepos(await readManifest(root));
    const repoPath = resolveRepoPath(root, findRepo(repos, DEFAULT_REPO_ID).path);
    const provider = getProvider(fleetProviderId());
    const { env, model } = await resolveFleetAuth(provider);
    const onOutput = (chunk: string) => aiLog(`task ${id}`, chunk);
    const deps = tauriOrchestratorDeps(root, onOutput);
    await runMaintainTask(deps, {
      repoPath,
      worktreeRoot: root,
      id,
      prompt,
      env,
      model,
      onStatus: (s) => patchRoot(root, { tasks: setTaskStatus(get().projects[root]?.tasks ?? [], id, s) }),
    });
  },

  approvePlan: async (verification) => {
    const activeRoot = get().activeRoot;
    const cmds = verification.map((c) => c.trim()).filter(Boolean);
    if (cmds.length === 0) {
      if (activeRoot) patchRoot(activeRoot, { error: "Enter at least one verification command to approve." });
      return;
    }
    const { prd, architecture } = get();
    if (!prd.trim() || !architecture.trim()) {
      if (activeRoot) patchRoot(activeRoot, { error: "Approve needs both a PRD and an architecture." });
      return;
    }
    if (activeRoot) patchRoot(activeRoot, { busy: "Approving plan…", error: null });
    try {
      const root = requireRoot();
      // Persist the plan so it reloads from git (§3.8) and the Dev agents can read it.
      await invoke("write_text_file", { path: `${root}/${PRD_PATH}`, content: prd });
      await invoke("write_text_file", { path: `${root}/${ARCH_PATH}`, content: architecture });
      // Optional Analyst brief + Technical Writer docs + DevOps ops plan, when present.
      const { analystBrief, techDocs, opsDoc } = get();
      if (analystBrief.trim()) await invoke("write_text_file", { path: `${root}/${BRIEF_PATH}`, content: analystBrief });
      if (techDocs.trim()) await invoke("write_text_file", { path: `${root}/${TECHDOCS_PATH}`, content: techDocs });
      if (opsDoc.trim()) await invoke("write_text_file", { path: `${root}/${OPS_PATH}`, content: opsDoc });
      // Optional UX/design + PO artifacts, when present.
      const { uxSpec, mockupHtml, poValidation } = get();
      if (uxSpec.trim()) {
        await invoke("write_text_file", { path: `${root}/${UX_PATH}`, content: uxSpec });
      }
      if (mockupHtml.trim()) {
        await invoke("write_text_file", { path: `${root}/${MOCKUP_PATH}`, content: mockupHtml });
      }
      if (poValidation.trim()) {
        await invoke("write_text_file", { path: `${root}/${PO_PATH}`, content: poValidation });
      }
      // Freeze the verification command in engine-owned state (agents can't forge it).
      // Build the per-repo verify map from the cadre.json registry so each repo's
      // verification command is frozen alongside the plan.
      const repos = parseRepos(await readManifest(root));
      const repoVerification: Record<string, string[]> = {};
      for (const r of repos) if (r.verify?.trim()) repoVerification[r.id] = [r.verify.trim()];
      await invoke("approve_plan", { root, verification: cmds, repoVerification });
      // Land on EXECUTE — the next step is breaking the plan into stories and dispatching agents.
      patchRoot(root, { verification: cmds, phase: "EXECUTE", needsReplan: false, busy: null });
      toast("Plan signed off — shard it into stories", "success");
      await logSession(root, `plan approved (PRD + architecture) — verified by: ${cmds.join(", ")}`);
    } catch (e) {
      const root = get().activeRoot;
      if (root) patchRoot(root, { error: String(e), busy: null });
      reportError("approve", e, { toastMessage: "Sign-off failed" });
    }
  },

  shardNextStory: async (epic = 1, repoId?: string) => {
    const activeRoot = get().activeRoot;
    if (activeRoot) patchRoot(activeRoot, { busy: "Sharding the next story (SM)…", error: null });
    try {
      const root = requireRoot();
      const auth = await getPlanningAuth();
      if (!auth.ready) {
        reportError("planning", new Error(auth.reason ?? "planning credential missing"));
        patchRoot(root, { busy: null });
        return;
      }
      const { prd, architecture, uxSpec } = get();
      const ids = useBmadStore.getState().stories.map((s) => s.id);
      const story = nextStoryNumber(epic, ids);
      const brownfield = get().projectContext;
      const planContext =
        `# PRD\n\n${prd}\n\n---\n\n# Architecture\n\n${architecture}` +
        (uxSpec.trim() ? `\n\n---\n\n# UX / Design Spec\n\n${uxSpec}` : "") +
        // Brownfield: the SM must slice stories against the REAL module layout,
        // file paths, and patterns — not invent a greenfield structure.
        (brownfield.trim() ? `\n\n---\n\n# Existing project analysis (brownfield)\n\n${brownfield}` : "");

      await generateStory(
        {
          callWithTool: (systemPrompt, userPrompt, tool) =>
            callTool({ apiKey: auth.apiKey, baseUrl: auth.baseUrl, model: planningModel(), systemPrompt, userPrompt, tool }),
          writeFile: (relPath, content) =>
            invoke("write_text_file", { path: `${root}/${relPath}`, content }),
        },
        { systemPrompt: SM_SYSTEM_PROMPT, planContext, epic, story, repoId }
      );
      // The story file lands in docs/stories/; the watcher reconciles it onto the board.
      patchRoot(root, { busy: null });
      toast(`Story ${epic}.${story} sharded onto the board`, "success");
    } catch (e) {
      const root = get().activeRoot;
      if (root) patchRoot(root, { error: String(e), busy: null });
      reportError("shard", e, { toastMessage: "Sharding failed" });
    }
  },

  shardBacklog: async (epic = 1) => {
    const activeRoot = get().activeRoot;
    if (activeRoot) patchRoot(activeRoot, { busy: "Sharding the full lifecycle backlog (SM)…", error: null });
    try {
      const root = requireRoot();
      const auth = await getPlanningAuth();
      if (!auth.ready) {
        reportError("planning", new Error(auth.reason ?? "planning credential missing"));
        patchRoot(root, { busy: null });
        return;
      }
      const { prd, architecture, uxSpec } = get();
      const ids = useBmadStore.getState().stories.map((s) => s.id);
      const start = nextStoryNumber(epic, ids);
      const brownfield = get().projectContext;
      const planContext =
        `# PRD\n\n${prd}\n\n---\n\n# Architecture\n\n${architecture}` +
        (uxSpec.trim() ? `\n\n---\n\n# UX / Design Spec\n\n${uxSpec}` : "") +
        // Brownfield: the SM must slice stories against the REAL module layout,
        // file paths, and patterns — not invent a greenfield structure.
        (brownfield.trim() ? `\n\n---\n\n# Existing project analysis (brownfield)\n\n${brownfield}` : "");

      const toolInput = await callTool({
        apiKey: auth.apiKey,
        baseUrl: auth.baseUrl,
        model: planningModel(),
        systemPrompt: SM_SYSTEM_PROMPT,
        userPrompt:
          "Produce the COMPLETE backlog to build AND operate the plan below. Cover every LAYER — " +
          "frontend/UI, backend/API, database (schema + migrations) — and every PHASE — setup, DevOps " +
          "(CI/CD, infra, deployment), tests, QA (test plans, e2e/acceptance), integration, monitoring, " +
          "documentation, and support. Do NOT return a backend-only backlog. Fully specify every story.\n\n## Plan context\n" +
          planContext,
        tool: CREATE_BACKLOG_TOOL,
      });
      const stories = backlogFromTool(toolInput, epic, start);
      for (const content of stories) {
        await shardStory({ writeFile: (relPath, c) => invoke("write_text_file", { path: `${root}/${relPath}`, content: c }) }, content);
      }
      patchRoot(root, { busy: null });
      toast(`Sharded ${stories.length} stories across the lifecycle`, "success");
    } catch (e) {
      const root = get().activeRoot;
      if (root) patchRoot(root, { error: String(e), busy: null });
      reportError("shard backlog", e, { toastMessage: "Backlog sharding failed" });
    }
  },

  dispatchStory: async (epic, story, opts) => {
    const key = `${epic}.${story}`;
    const silent = opts?.silent ?? false;
    const agentId = opts?.agentId;
    // Capture the target project ONCE at the top. Every per-project write in this
    // action (logs, active, codeReviews, busy, error) targets THIS root — never
    // get().activeRoot — so a background dispatch never corrupts the foreground.
    let root: string;
    try {
      root = requireRoot();
    } catch (e) {
      const ar = get().activeRoot;
      if (ar) patchRoot(ar, { error: String(e), busy: silent ? (get().projects[ar]?.busy ?? null) : null });
      reportError(`dispatch ${epic}.${story}`, e, { toastMessage: `Dispatch failed for ${epic}.${story}` });
      return;
    }
    // Fresh log for this run; the sink appends streamed output (capped). Mark the
    // story active so the UI shows it as genuinely running (vs. an orphaned one).
    // In parallel mode (silent) the caller owns the `busy` banner.
    if (!silent) patchRoot(root, { busy: `Dispatching story ${epic}.${story}…` });
    patchRoot(root, { error: null });
    patchRoot(root, {
      logs: { ...(get().projects[root]?.logs ?? {}), [key]: "" },
      active: { ...(get().projects[root]?.active ?? {}), [key]: true },
    });
    const onOutput = (chunk: string) => {
      aiLog(`story ${key}`, chunk);
      const prev = get().projects[root]?.logs?.[key] ?? "";
      const next = prev + chunk;
      const capped = next.length > 200_000 ? next.slice(next.length - 200_000) : next;
      const patch: Partial<CadreSlice> = { logs: { ...(get().projects[root]?.logs ?? {}), [key]: capped } };
      // When running with an agent, also stream to the agent log.
      if (agentId) {
        const agentPrev = get().projects[root]?.agentLogs?.[agentId] ?? "";
        const agentNext = agentPrev + chunk;
        const agentCapped = agentNext.length > 200_000 ? agentNext.slice(agentNext.length - 200_000) : agentNext;
        patch.agentLogs = { ...(get().projects[root]?.agentLogs ?? {}), [agentId]: agentCapped };
      }
      patchRoot(root, patch);
    };
    try {
      // Find the story file (docs/stories/{epic}.{story}.{slug}.md) and read it.
      const storyPath = await findStoryPath(root, epic, story);
      if (!storyPath) throw new Error(`No story file for ${epic}.${story} — shard it first.`);
      const storyMarkdown = await invoke<string>("read_file", { path: storyPath });

      // Resolve this story's target repo from the story markdown and the cadre.json registry.
      // For single-repo projects (no cadre.json or no repos array), parseRepos returns
      // [{id:"main",path:"."}] and parseStoryRepo returns "main", so repoPath === root.
      const repoId = parseStoryRepo(storyMarkdown);
      const repos = parseRepos(await readManifest(root));
      const repoPath = resolveRepoPath(root, findRepo(repos, repoId).path);

      // Inject the shared Context Store (architecture + .cadre/context) so every
      // parallel agent builds against the same interfaces and decisions.
      const alwaysFiles = opts?.context ?? (await loadSharedContext(root));
      const prompt = composeDispatchPrompt({
        systemPrompt: DEV_SYSTEM_PROMPT,
        storyMarkdown,
        alwaysFiles,
      });

      // Resolve the model + per-agent env for the selected fleet provider.
      const provider = getProvider(fleetProviderId());
      const { env, model } = await resolveFleetAuth(provider);
      onOutput(`[cadre] dispatching on ${provider.name} (${model ?? "CLI default model"})\n`);

      const storyLabel = useBmadStore.getState().stories.find((c) => c.id === key)?.title;
      const named = storyLabel ? `${key} "${storyLabel}"` : key;

      // Resolve this story's Claude session: mint one on first dispatch, resume it on a
      // re-dispatch so the retry keeps the prior attempt's context. Opt-out via settings.
      // In pool mode with an agentId, use the AGENT-keyed session (persistent across tasks,
      // reset after K tasks) instead of the story-keyed session.
      let sessionId: string | undefined;
      let resumeSession = false;
      const settings = useSettingsStore.getState();
      const fileDeps = {
        readFile: (p: string) => invoke<string>("read_file", { path: p }),
        writeFile: (p: string, c: string) => invoke("write_text_file", { path: p, content: c }).then(() => {}),
      };
      if (agentId) {
        // Agent-keyed session: carries context across tasks; resets after sessionResetK tasks.
        const sess = await resolveAgentSession(
          fileDeps,
          root,
          agentId,
          settings.sessionResetK,
          () => crypto.randomUUID()
        ).catch(() => null);
        if (sess) {
          sessionId = sess.sessionId;
          resumeSession = sess.resume;
          if (sess.resume) onOutput(`[cadre] ${agentId}: resuming persistent session (task-keyed context)\n`);
          else onOutput(`[cadre] ${agentId}: fresh session (new or reset after ${settings.sessionResetK} tasks)\n`);
        }
        // Mark agent slot as working.
        const currentSlots = get().projects[root]?.agentSlots ?? [];
        const updatedSlots: AgentSlot[] = currentSlots.map((s) =>
          s.agentId === agentId ? { ...s, currentStory: key, status: "working" } : s
        );
        patchRoot(root, { agentSlots: updatedSlots });
      } else if (settings.resumeSessions) {
        const sess = await resolveStorySession(
          fileDeps,
          root,
          key,
          () => crypto.randomUUID()
        ).catch(() => null);
        if (sess) {
          sessionId = sess.sessionId;
          resumeSession = sess.resume;
          if (sess.resume) onOutput(`[cadre] resuming prior session for ${key} to keep its context\n`);
        }
      }
      await logSession(root, `dispatched story ${named} on ${provider.name}${resumeSession ? " (resumed session)" : ""}`);

      // Route engine status writes through bmadStore so the board updates
      // optimistically (its own-write echo is then suppressed by the watcher).
      // Pass the captured root so background dispatches write to the correct
      // project slice, never the foreground project (which may have changed).
      const setStatus = (e: number, s: number, status: Status) =>
        useBmadStore.getState().setStatus(e, s, status, root);
      const deps = { ...tauriOrchestratorDeps(root, onOutput), setStatus };

      const res = await runApprovedStory(deps, {
        root,
        repoPath,
        repoId,
        epic,
        story,
        prompt,
        timeoutSecs: 1800,
        agentTimeoutSecs: agentTimeoutSecs(),
        retriesOnNonZero: 0,
        model,
        env,
        sessionId,
        resumeSession,
      });
      if (res.timedOut) {
        onOutput(
          `\n[cadre] agent timed out after ${useSettingsStore.getState().agentTimeoutMins}m and was stopped — Failed. ` +
            `A silent stall is usually a bad/expired API key or a stuck task. Check the key in Settings, or raise the timeout.\n`
        );
      }
      if (!silent) patchRoot(root, { busy: null });
      if (res.status === "Done") {
        // The agent has built + the engine verified; it's now in
        // review/merge — reflect that on its slot so the org chart shows "verifying".
        if (agentId) {
          const slots = get().projects[root]?.agentSlots ?? [];
          patchRoot(root, {
            agentSlots: slots.map((s) => (s.agentId === agentId ? { ...s, status: "verifying" } : s)),
          });
        }
        // QA gate: run the adversarial code-review fleet on the worktree BEFORE
        // integrating. If it blocks, quarantine the story (Blocked) and don't merge
        // — the review has real authority, not just an advisory badge. Toggleable.
        if (useSettingsStore.getState().gateOnReview) {
          await get().reviewStory(epic, story, root, repoId);
          const reviews = get().projects[root]?.codeReviews?.[key]?.reviews ?? [];
          if (aggregateReviews(reviews).verdict === "block") {
            await useBmadStore.getState().setStatus(epic, story, "Blocked", root);
            onOutput(`\n[cadre] code review BLOCKED ${epic}.${story} — not integrated; resolve the findings\n`);
            toast(`Story ${epic}.${story}: review blocked — not merged`, "error");
            await logSession(root, `story ${named} BLOCKED by code review — not integrated`);
            return;
          }
        }
        // Merge the verified worktree back into main — serialized so parallel
        // stories integrate safely. On conflict, mark Blocked for the human (A).
        const integ = await withMergeLock(() =>
          integrateStory({ runGit: deps.runGit }, { root, repoPath, epic, story })
        );
        if (integ.conflict) {
          let resolved = false;
          if (useSettingsStore.getState().autoResolveMerge) {
            onOutput(`\n[cadre] merge conflict on ${epic}.${story} — attempting auto-resolution\n`);
            try {
              const context = await loadSharedContext(root);
              const prompt = composeResolverPrompt({ storyMarkdown, alwaysFiles: context, epic, story });
              const provider = getProvider(fleetProviderId());
              const { env, model } = await resolveFleetAuth(provider);
              const approval = await invoke<PlanApproval | null>("get_plan_approval", { root }).catch(() => null);
              const commands = approval?.verification ?? [];
              const res = await withMergeLock(() => resolveMergeConflict(
                tauriResolveConflictDeps(onOutput),
                { root, repoPath, epic, story, storyBranch: storyBranch(epic, story), prompt,
                  commands, timeoutSecs: 1800, agentTimeoutSecs: agentTimeoutSecs(), model, env }
              ));
              resolved = res.resolved;
              if (!resolved) onOutput(`\n[cadre] auto-resolution failed (${res.reason}) for ${epic}.${story}\n`);
            } catch (e) {
              reportError(`resolve ${epic}.${story}`, e);
            }
          }
          if (resolved) {
            onOutput(`\n[cadre] auto-resolved & integrated ${epic}.${story}\n`);
            toast(`Story ${epic}.${story}: conflict auto-resolved & integrated`, "success");
            await logSession(root, `auto-resolved merge conflict for story ${named} and integrated`);
          } else {
            await useBmadStore.getState().setStatus(epic, story, "Blocked", root);
            onOutput(`\n[cadre] merge conflict integrating ${epic}.${story} — Blocked for manual integration\n`);
            toast(`Story ${epic}.${story}: merge conflict — Blocked for you to integrate`, "error");
            await logSession(root, `story ${named} hit a merge conflict — Blocked for manual integration`);
          }
        } else {
          onOutput(`\n[cadre] integrated story ${epic}.${story} into main\n`);
          toast(`Story ${epic}.${story}: Done & integrated`, "success");
          await logSession(root, `completed & integrated story ${named} into main`);
        }
      } else {
        toast(`Story ${epic}.${story}: ${res.status}`, "error");
        await logSession(root, `story ${named} ended ${res.status}${res.timedOut ? " (timed out)" : ""}`);
      }
    } catch (e) {
      onOutput(`\n[cadre] dispatch error: ${String(e)}\n`);
      patchRoot(root, { error: String(e), busy: silent ? (get().projects[root]?.busy ?? null) : null });
      reportError(`dispatch ${epic}.${story}`, e, { toastMessage: `Dispatch failed for ${epic}.${story}` });
    } finally {
      // No longer running this session — an InProgress/InReview status left on the
      // board now reads as interrupted (see isInterrupted). Target the CAPTURED root.
      const active = { ...(get().projects[root]?.active ?? {}) };
      delete active[key];
      const finalPatch: Partial<CadreSlice> = { active };
      // Reset the agent slot back to idle when an agent is assigned.
      if (agentId) {
        const currentSlots = get().projects[root]?.agentSlots ?? [];
        finalPatch.agentSlots = currentSlots.map((s) =>
          s.agentId === agentId ? { ...s, currentStory: null, status: "idle" } : s
        );
      }
      patchRoot(root, finalPatch);
    }
  },

  dispatchReady: async () => {
    try {
      const root = requireRoot();
      // Ready = gated for the fleet: Approved (draft-reviewed) or Failed (retry).
      const ready = useBmadStore
        .getState()
        .stories.filter((c) => c.status === "Approved" || c.status === "Failed");
      if (ready.length === 0) {
        toast("No approved stories to dispatch — approve a draft first", "info");
        return;
      }

      // Read each story's declared files (repo-namespaced) — shared by both paths.
      const scheduled = await Promise.all(
        ready.map(async (c) => {
          const p = await findStoryPath(root, c.epic, c.story);
          const md = p ? await invoke<string>("read_file", { path: p }).catch(() => "") : "";
          const storyRepoId = parseStoryRepo(md);
          return { id: c.id, files: parseStoryFiles(md).map((f) => `${storyRepoId}:${f}`) };
        })
      );
      const byId = new Map(ready.map((c) => [c.id, c]));

      // Load the shared Context Store once and reuse it for every agent.
      const context = await loadSharedContext(root);

      // ---- Role pool: always-on dispatch ----
      const maxDev = useSettingsStore.getState().maxDevAgents;
      const existingSlots = get().projects[root]?.agentSlots ?? [];
      const slots = composeRoster(maxDev, existingSlots);
      patchRoot(root, { agentSlots: slots, error: null });

      // Build role map from story titles
      const titleMap = new Map(ready.map((c) => [c.id, c.title ?? ""]));
      const roleOf = (id: string): "dev" | "qa" | "devops" => {
        const title = titleMap.get(id) ?? "";
        const { kind } = storyRole(title);
        // docs and dev both go to dev pool
        return kind === "qa" ? "qa" : kind === "devops" ? "devops" : "dev";
      };

      const { dev: devReady, qa: qaReady, devops: devopsReady } = partitionByRole(scheduled, roleOf);

      // Mutable pump state
      let remainingDev: ReadyStory[] = [...devReady];
      let remainingQa: ReadyStory[] = [...qaReady];
      let remainingDevops: ReadyStory[] = [...devopsReady];
      const inFlightFiles = new Set<string>();
      const idleDevAgents: string[] = slots.filter((s) => s.role === "dev").map((s) => s.agentId);

      let inFlight = 0;
      let qaBusy = false;
      let devopsBusy = false;
      let resolveAll!: () => void;
      const allDone = new Promise<void>((res) => { resolveAll = res; });

      const totalStories = scheduled.length;
      patchRoot(root, {
        busy: `Fleet: dispatching ${totalStories} stor${totalStories === 1 ? "y" : "ies"} (QA · DevOps · ${maxDev} Dev max)…`,
      });

      function pump() {
        const allEmpty = remainingDev.length === 0 && remainingQa.length === 0 && remainingDevops.length === 0;
        if (allEmpty && inFlight === 0) {
          resolveAll();
          return;
        }

        // ── QA track (one at a time on agent-qa) ──
        if (remainingQa.length > 0 && !qaBusy) {
          // Pick the first QA story that is file-disjoint from inFlightFiles
          const pick = remainingQa.find((s) => s.files.length === 0 ? inFlightFiles.size === 0 : !s.files.some((f) => inFlightFiles.has(f)));
          if (pick) {
            remainingQa = remainingQa.filter((s) => s.id !== pick.id);
            pick.files.forEach((f) => inFlightFiles.add(f));
            inFlight++;
            qaBusy = true;
            const card = byId.get(pick.id)!;
            get().dispatchStory(card.epic, card.story, { silent: true, agentId: QA_AGENT_ID, context }).finally(() => {
              inFlight--;
              qaBusy = false;
              pick.files.forEach((f) => inFlightFiles.delete(f));
              pump();
            });
          }
        }

        // ── DevOps track (one at a time on agent-devops) ──
        if (remainingDevops.length > 0 && !devopsBusy) {
          const pick = remainingDevops.find((s) => s.files.length === 0 ? inFlightFiles.size === 0 : !s.files.some((f) => inFlightFiles.has(f)));
          if (pick) {
            remainingDevops = remainingDevops.filter((s) => s.id !== pick.id);
            pick.files.forEach((f) => inFlightFiles.add(f));
            inFlight++;
            devopsBusy = true;
            const card = byId.get(pick.id)!;
            get().dispatchStory(card.epic, card.story, { silent: true, agentId: DEVOPS_AGENT_ID, context }).finally(() => {
              inFlight--;
              devopsBusy = false;
              pick.files.forEach((f) => inFlightFiles.delete(f));
              pump();
            });
          }
        }

        // ── Dev track (up to maxDev parallel, file-disjoint) ──
        // Fallback: any QA/DevOps story whose role-agent is busy may be picked by a Dev slot
        const qaAgentBusy = qaBusy;
        const devopsAgentBusy = devopsBusy;

        // Build the dev candidate list: dev stories + fallback qa/devops stories
        const devCandidates: ReadyStory[] = [
          ...remainingDev,
          ...(qaAgentBusy ? remainingQa : []),
          ...(devopsAgentBusy ? remainingDevops : []),
        ];

        if (idleDevAgents.length > 0 && devCandidates.length > 0) {
          const picks = pickAssignable(devCandidates, inFlightFiles, idleDevAgents.length);
          for (const pick of picks) {
            // Remove from whichever list it came from
            const wasQa = remainingQa.some((s) => s.id === pick.id);
            const wasDevops = remainingDevops.some((s) => s.id === pick.id);
            if (wasQa) remainingQa = remainingQa.filter((s) => s.id !== pick.id);
            else if (wasDevops) remainingDevops = remainingDevops.filter((s) => s.id !== pick.id);
            else remainingDev = remainingDev.filter((s) => s.id !== pick.id);

            const agentId = idleDevAgents.shift()!;
            pick.files.forEach((f) => inFlightFiles.add(f));
            inFlight++;

            const card = byId.get(pick.id)!;
            get().dispatchStory(card.epic, card.story, { silent: true, agentId, context }).finally(() => {
              inFlight--;
              idleDevAgents.push(agentId);
              pick.files.forEach((f) => inFlightFiles.delete(f));
              pump();
            });
          }
        }

        // Safety: nothing could be dispatched and nothing is in flight → resolve to avoid hang
        const nowEmpty = remainingDev.length === 0 && remainingQa.length === 0 && remainingDevops.length === 0;
        if (nowEmpty && inFlight === 0) {
          resolveAll();
          return;
        }
        if (inFlight === 0 && !nowEmpty) {
          // Stories remain but nothing can be dispatched right now (all files conflicting OR
          // no dev slots + role agents busy). This should not happen for valid input,
          // but surface it rather than hanging.
          const total = remainingDev.length + remainingQa.length + remainingDevops.length;
          reportError("role pool", new Error(`${total} ready stor${total === 1 ? "y" : "ies"} could not be assigned to any agent`));
          resolveAll();
        }
      }

      pump();
      await allDone;

      patchRoot(root, { busy: null });
      const total = scheduled.length;
      toast(`Fleet: dispatched ${total} stor${total === 1 ? "y" : "ies"} (QA · DevOps · Dev)`, "success");
    } catch (e) {
      const root = get().activeRoot;
      if (root) patchRoot(root, { error: String(e), busy: null });
      reportError("dispatch ready", e, { toastMessage: "Parallel dispatch failed" });
    }
  },

  approveStory: async (epic, story) => {
    try {
      await useBmadStore.getState().setStatus(epic, story, "Approved");
      toast(`Story ${epic}.${story} approved — ready to dispatch`, "success");
    } catch (e) {
      const root = get().activeRoot;
      if (root) patchRoot(root, { error: String(e) });
      reportError(`approve ${epic}.${story}`, e, { toastMessage: `Approve failed for ${epic}.${story}` });
    }
  },

  reviewStory: async (epic, story, root?: string, repoId?: string) => {
    const key = `${epic}.${story}`;
    // If a captured root is provided (e.g. from dispatchStory's gate), use it so
    // background dispatches write the correct project's slice even if the foreground
    // has switched. Otherwise fall back to the live foreground project.
    let target: string;
    try {
      target = root ?? requireRoot();
    } catch (e) {
      const ar = get().activeRoot;
      if (ar) patchRoot(ar, { error: String(e) });
      reportError(`review ${key}`, e, { toastMessage: `Review failed for ${key}` });
      return;
    }
    patchRoot(target, { error: null });
    patchRoot(target, {
      codeReviews: { ...(get().projects[target]?.codeReviews ?? {}), [key]: { status: "reviewing" } },
    });
    const onOutput = (chunk: string) => {
      aiLog(`review ${key}`, chunk);
      const prev = get().projects[target]?.logs?.[key] ?? "";
      const next = prev + chunk;
      const capped = next.length > 200_000 ? next.slice(next.length - 200_000) : next;
      patchRoot(target, { logs: { ...(get().projects[target]?.logs ?? {}), [key]: capped } });
    };
    try {
      // Same provider routing as dispatch — reviewers are agents on the fleet.
      const provider = getProvider(fleetProviderId());
      const { env, model } = await resolveFleetAuth(provider);
      onOutput(`[cadre] dispatching ${CODE_REVIEW_LENSES.length} adversarial reviewers on ${provider.name}\n`);

      // Resolve the repo id: use the caller-supplied value (from a background dispatch
      // gate that already parsed the story) or parse the story markdown. For single-repo
      // projects parseStoryRepo returns "main" so behaviour is identical to before.
      const rid = repoId ?? parseStoryRepo(await get().getStoryMarkdown(epic, story));

      const reviews = await reviewStoryFleet(tauriReviewFleetDeps(onOutput), {
        root: target,
        repoId: rid,
        epic,
        story,
        lenses: CODE_REVIEW_LENSES,
        model,
        env,
      });
      const agg = aggregateReviews(reviews);
      onOutput(`[cadre] review fleet ${agg.verdict === "block" ? "BLOCKED" : "accepted"} (${agg.findingCount} findings)\n`);
      patchRoot(target, {
        codeReviews: { ...(get().projects[target]?.codeReviews ?? {}), [key]: { status: "done", reviews } },
      });
      toast(
        `Review ${key}: ${agg.verdict === "block" ? `blocked (${agg.findingCount})` : "accepted"}`,
        agg.verdict === "block" ? "error" : "success"
      );
    } catch (e) {
      patchRoot(target, {
        codeReviews: { ...(get().projects[target]?.codeReviews ?? {}), [key]: { status: "done", reviews: [] } },
        error: String(e),
      });
      reportError(`review ${key}`, e, { toastMessage: `Review failed for ${key}` });
    }
  },

  documentProject: async () => {
    // Capture the target project once; every per-project write targets THIS root.
    let root: string;
    try {
      root = requireRoot();
    } catch (e) {
      const ar = get().activeRoot;
      if (ar) patchRoot(ar, { error: String(e) });
      reportError("document project", e, { toastMessage: "Project analysis failed" });
      return;
    }
    patchRoot(root, { busy: "Analyzing the existing project (2 passes)…", analyzingBrownfield: true, error: null });
    const onOutput = (chunk: string) => {
      aiLog("analysis", chunk);
      const prev = get().projects[root]?.logs?.["brownfield"] ?? "";
      const next = prev + chunk;
      const capped = next.length > 200_000 ? next.slice(next.length - 200_000) : next;
      patchRoot(root, { logs: { ...(get().projects[root]?.logs ?? {}), brownfield: capped } });
    };
    try {
      const provider = getProvider(fleetProviderId());
      const { env, model } = await resolveFleetAuth(provider);

      // Read the manifest (tolerant — missing cadre.json defaults to single root repo).
      const manifestJson = await readManifest(root);
      const repoRefs = parseRepos(manifestJson);
      // Resolve each repo's path to an absolute path for the orchestrator.
      const repos = repoRefs.map((r) => ({
        id: r.id,
        name: r.name,
        path: resolveRepoPath(root, r.path),
      }));

      const baseDeps = tauriReviewFleetDeps(onOutput);
      const results = await documentAllRepos(
        {
          ...baseDeps,
          detectVerify: (repoRoot) => detectProjectVerify(repoRoot).then((v) => v || null),
          onRepoStart: (repo, i, total) => {
            onOutput(`\n\n=== Analyzing ${repo.name} (${i + 1}/${total}) ===\n`);
          },
        },
        { repos, passes: 2, model, env }
      );

      // Compose aggregate analysis (single repo → verbatim; multi → sectioned).
      const projectContext = composeAggregateAnalysis(results);
      // Single repo: documentAllRepos already wrote the (identical, verbatim) brief to
      // ${root}/docs/brownfield-analysis.md — don't rewrite. Multi repo: write the
      // sectioned aggregate to the project home so hydrate + loadSharedContext read the
      // whole-project picture. (Each external repo keeps its own brief at its own path;
      // if one repo IS the root, the home doc is intentionally the aggregate.)
      if (results.length > 1) {
        await invoke("write_text_file", {
          path: `${root}/${BROWNFIELD_DOC_PATH}`,
          content: projectContext,
        }).catch(() => {});
      }

      // Persist detected verify commands to cadre.json via reposStore.
      for (const result of results) {
        if (result.detectedVerify) {
          await useRepos.getState().setVerify(root, result.id, result.detectedVerify).catch(() => {});
        }
      }

      // Pre-fill the single detectedVerify field from the default/first repo
      // so the single-repo sign-off verify field still pre-fills as before.
      const firstVerify = results[0]?.detectedVerify ?? "";

      patchRoot(root, { projectContext, isBrownfield: false, analyzingBrownfield: false, detectedVerify: firstVerify, busy: null });
      toast("Project analyzed — the PM now has context", "success");
    } catch (e) {
      patchRoot(root, { error: String(e), analyzingBrownfield: false, busy: null });
      reportError("document project", e, { toastMessage: "Project analysis failed" });
    }
  },

  getStoryMarkdown: async (epic, story) => {
    const root = useBmadStore.getState().projectRoot;
    if (!root) return "";
    try {
      const path = await findStoryPath(root, epic, story);
      if (!path) return "";
      return await invoke<string>("read_file", { path });
    } catch {
      return "";
    }
  },

  cascadeReplan: async () => {
    if (get().busy) return;
    const activeRoot = get().activeRoot;
    if (activeRoot) patchRoot(activeRoot, { busy: "Updating the architecture…", error: null });
    try {
      const root = requireRoot();
      const auth = await getPlanningAuth();
      if (!auth.ready) {
        reportError("planning", new Error(auth.reason ?? "planning credential missing"));
        patchRoot(root, { busy: null });
        return;
      }
      const prd = get().projects[root]?.prd ?? "";

      // 1. Architect re-derives the architecture from the amended PRD.
      const arch = await planningTurn({
        apiKey: auth.apiKey,
        baseUrl: auth.baseUrl,
        model: planningModel(),
        systemPrompt: `${ARCHITECT_SYSTEM_PROMPT}\n\n## Current PRD\n${prd}`,
        messages: [
          {
            role: "user",
            content:
              "The PRD changed — scope was added or requirements changed. Produce the FULL updated architecture that reflects the current PRD.",
          },
        ],
      });
      if (arch.document) patchRoot(root, { architecture: arch.document });

      // 2. If a UX spec exists, the Designer updates the spec + mockup.
      if (get().projects[root]?.uxSpec.trim()) {
        patchRoot(root, { busy: "Updating the UX…" });
        const ux = await planningTurn({
          apiKey: auth.apiKey,
          baseUrl: auth.baseUrl,
          model: planningModel(),
          systemPrompt: `${DESIGN_SYSTEM_PROMPT}\n\n## Current PRD\n${prd}`,
          messages: [
            {
              role: "user",
              content:
                "The PRD changed. Update the UX spec and the HTML mockup to reflect the current PRD; emit both.",
            },
          ],
          allowMockup: true,
        });
        if (ux.document) patchRoot(root, { uxSpec: ux.document });
        if (ux.mockup) patchRoot(root, { mockupHtml: ux.mockup });
      }

      // 3. Persist the refreshed plan to disk.
      patchRoot(root, { busy: "Writing the updated plan…" });
      const slice = get().projects[root] ?? emptyCadreSlice();
      const { architecture, uxSpec, mockupHtml } = slice;
      await invoke("write_text_file", { path: `${root}/${PRD_PATH}`, content: prd });
      await invoke("write_text_file", { path: `${root}/${ARCH_PATH}`, content: architecture });
      if (uxSpec.trim()) await invoke("write_text_file", { path: `${root}/${UX_PATH}`, content: uxSpec });
      if (mockupHtml.trim()) await invoke("write_text_file", { path: `${root}/${MOCKUP_PATH}`, content: mockupHtml });

      // 4. Shard a story for the new scope (dispatch stays gated on re-approval).
      patchRoot(root, { busy: "Sharding a story for the new scope…" });
      await get().shardNextStory(1);

      // The plan is refreshed but must be RE-APPROVED by a human before dispatch.
      patchRoot(root, { busy: null });
      toast("Plan updated downstream — re-approve to dispatch", "info");
    } catch (e) {
      const root = get().activeRoot;
      if (root) patchRoot(root, { error: String(e), busy: null });
      reportError("cascade replan", e, { toastMessage: "Cascade failed" });
    }
  },

  hydrateFromProject: async () => {
    const root = useBmadStore.getState().projectRoot;
    if (!root) return;
    const readOr = async (rel: string): Promise<string> => {
      try {
        return await invoke<string>("read_file", { path: `${root}/${rel}` });
      } catch {
        return "";
      }
    };
    const [prd, architecture, uxSpec, mockupHtml, poValidation, projectContext, analystBrief, techDocs, opsDoc] = await Promise.all([
      readOr(PRD_PATH),
      readOr(ARCH_PATH),
      readOr(UX_PATH),
      readOr(MOCKUP_PATH),
      readOr(PO_PATH),
      readOr(BROWNFIELD_DOC_PATH),
      readOr(BRIEF_PATH),
      readOr(TECHDOCS_PATH),
      readOr(OPS_PATH),
    ]);
    const approval = await invoke<PlanApproval | null>("get_plan_approval", { root }).catch(() => null);
    const approved = !!approval?.approved && (approval?.verification?.length ?? 0) > 0;

    // Brownfield: existing code present, but no Cadre plan (PRD) and no analysis yet.
    let isBrownfield = false;
    if (!prd.trim() && !projectContext.trim()) {
      try {
        const entries = await invoke<{ name: string; is_dir: boolean }[]>("list_directory", { path: root });
        const ignore = new Set([".git", ".cadre", "docs", "cadre.json", "README.md", ".gitignore", ".DS_Store"]);
        isBrownfield = entries.some((e) => !ignore.has(e.name));
      } catch {
        /* ignore */
      }
    }

    // Write into THIS root's slice, reading prior values from the slice (not the mirror).
    const prior = get().projects[root] ?? emptyCadreSlice();
    patchRoot(root, {
      prd: prd || prior.prd,
      architecture: architecture || prior.architecture,
      analystBrief: analystBrief || prior.analystBrief,
      techDocs: techDocs || prior.techDocs,
      opsDoc: opsDoc || prior.opsDoc,
      uxSpec: uxSpec || prior.uxSpec,
      mockupHtml: mockupHtml || prior.mockupHtml,
      poValidation: poValidation || prior.poValidation,
      projectContext: projectContext || prior.projectContext,
      isBrownfield,
      verification: approval?.verification ?? prior.verification,
      // Approved on reload: always land on EXECUTE (the combined shard + fleet view).
      phase: approved ? "EXECUTE" : prior.phase,
    });
  },
  };
});
