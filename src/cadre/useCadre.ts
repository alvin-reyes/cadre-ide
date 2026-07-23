import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Phase } from "./components/PhaseStepper";
import { useBmadStore } from "../stores/bmadStore";
import { useSettingsStore } from "../stores/settingsStore";
import { toast } from "../stores/toastStore";
import { aiLog } from "../stores/aiLogStore";
import { callTool, planningTurn } from "../lib/planning/planningChat";
import { ARCHITECT_SYSTEM_PROMPT, DESIGN_SYSTEM_PROMPT } from "../lib/planning/personas";
import { generateStory } from "../lib/planning/generateStory";
import { runApprovedStory } from "../lib/engine/orchestrator";
import { reviewStory as reviewStoryFleet, aggregateReviews, type LensReview } from "../lib/engine/reviewFleet";
import { documentProject as documentProjectFleet, BROWNFIELD_DOC_PATH } from "../lib/engine/brownfield";
import { CODE_REVIEW_LENSES } from "../lib/planning/review";
import { tauriOrchestratorDeps, tauriReviewFleetDeps } from "../lib/engine/tauriDeps";
import { composeDispatchPrompt, type AlwaysFile } from "../lib/engine/dispatch";
import { nextStoryNumber, parseStoryFiles, shardStory } from "../lib/engine/shard";
import { CREATE_BACKLOG_TOOL, backlogFromTool } from "../lib/planning/storyTool";
import { scheduleParallel } from "../lib/engine/schedule";
import { detectVerifyCommand } from "../lib/engine/detectVerify";
import { integrateStory } from "../lib/engine/integrate";
import { getProvider, resolveAgentEnv } from "../lib/engine/providers";
import { secretGet } from "../lib/secrets";
import type { Status } from "../lib/engine/status";
import type { PlanApproval } from "../lib/engine/planApproval";

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

/** The configured planning-brain model (Settings override, else the default). */
export function planningModel(): string {
  return useSettingsStore.getState().planningModel || MODEL;
}

/** The configured fleet-model override, if any (empty → caller uses provider default). */
export function fleetModelOverride(): string {
  return useSettingsStore.getState().fleetModel || "";
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

Think across every LAYER (frontend/UI, backend/API, database) and the WHOLE lifecycle (setup, DevOps/CI-CD/deployment, tests, QA/acceptance testing, integration, monitoring, documentation, support) — not just backend features. A backlog that is backend-only, or missing the frontend, database, QA, or deployment work, is incomplete.`;

const DEV_SYSTEM_PROMPT = `You are the Dev agent. Implement the assigned story test-first: write the failing test, then the minimal code to make it pass. Follow the project's standards. Do NOT mark the story done — Cadre runs the verification command and decides.

SHARED CONTEXT: other stories build in parallel with you. If you create or change something other stories must agree on — a shared interface, type, API contract, config key, or an important decision — record it in a short Markdown file under \`.cadre/context/\` (e.g. \`.cadre/context/auth-api.md\`). Keep those files small and factual. Before inventing a shared contract, check what's already in \`.cadre/context/\` and reuse it. This is how parallel and later agents stay consistent.`;

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

interface CadreState {
  phase: Phase;
  /** the planning artifacts, as they form in the Planning Studio */
  prd: string;
  architecture: string;
  /** optional Analyst brief (discovery) and Technical Writer documentation */
  analystBrief: string;
  techDocs: string;
  /** optional UX/design artifacts (Design tab) — spec + a live HTML mockup */
  uxSpec: string;
  mockupHtml: string;
  /** optional PO validation report (PO tab) — sign-off / gaps vs the PRD */
  poValidation: string;
  /** brownfield analysis of an existing project (grounds the PM), if generated */
  projectContext: string;
  /** true when the opened project has existing code but no Cadre plan yet */
  isBrownfield: boolean;
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
  /** which model provider the Dev fleet runs on (id from engine PROVIDERS) */
  fleetProvider: string;
  /** a human-readable status while an async action runs (null = idle) */
  busy: string | null;
  error: string | null;

  setPhase: (phase: Phase) => void;
  setPrd: (md: string) => void;
  setArchitecture: (md: string) => void;
  setUxSpec: (md: string) => void;
  setAnalystBrief: (md: string) => void;
  setTechDocs: (md: string) => void;
  setMockupHtml: (html: string) => void;
  setPoValidation: (md: string) => void;
  setFleetProvider: (id: string) => void;
  clearError: () => void;

  /** Freeze the verification command, write the plan to disk, unlock the fleet. */
  approvePlan: (verification: string[]) => Promise<void>;
  /** Run the SM to shard the next story for `epic` (default 1). */
  shardNextStory: (epic?: number) => Promise<void>;
  /** Run the SM to shard the COMPLETE lifecycle backlog (features + tests + deploy + support…). */
  shardBacklog: (epic?: number) => Promise<void>;
  /** Dispatch a Dev agent for a story; Cadre verifies and writes the status. */
  dispatchStory: (epic: number, story: number, opts?: { silent?: boolean; context?: AlwaysFile[] }) => Promise<void>;
  /**
   * Dispatch ALL ready stories in parallel, grouped so no two concurrent agents
   * touch the same declared file (disjoint sharding); file-sharing stories run in
   * later batches. Every agent gets the shared Context Store injected.
   */
  dispatchReady: () => Promise<void>;
  /** Gate a sharded story for the fleet: Draft → Approved (the SM/CTO review step). */
  approveStory: (epic: number, story: number) => Promise<void>;
  /** Run the adversarial code-review fleet (diverse-lens agent loops) on a story. */
  reviewStory: (epic: number, story: number) => Promise<void>;
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
  return files;
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

function requireKey(): string {
  const key = useSettingsStore.getState().anthropicApiKey;
  if (!key) throw new Error("Add your Anthropic API key in the Planning Studio first.");
  return key;
}

export const useCadre = create<CadreState>((set, get) => ({
  phase: "PLAN",
  prd: "",
  architecture: "",
  uxSpec: "",
  analystBrief: "",
  techDocs: "",
  mockupHtml: "",
  poValidation: "",
  projectContext: "",
  isBrownfield: false,
  detectedVerify: "",
  verification: [],
  needsReplan: false,
  logs: {},
  codeReviews: {},
  active: {},
  fleetProvider: "claude",
  busy: null,
  error: null,

  setPhase: (phase) => set({ phase }),
  // Editing a plan artifact after approval marks the plan as needing re-approval.
  setPrd: (prd) => set((s) => ({ prd, needsReplan: s.verification.length > 0 ? true : s.needsReplan })),
  setArchitecture: (architecture) =>
    set((s) => ({ architecture, needsReplan: s.verification.length > 0 ? true : s.needsReplan })),
  setUxSpec: (uxSpec) => set((s) => ({ uxSpec, needsReplan: s.verification.length > 0 ? true : s.needsReplan })),
  setAnalystBrief: (analystBrief) => set({ analystBrief }),
  setTechDocs: (techDocs) => set({ techDocs }),
  setMockupHtml: (mockupHtml) => set({ mockupHtml }),
  setPoValidation: (poValidation) => set({ poValidation }),
  setFleetProvider: (fleetProvider) => set({ fleetProvider }),
  clearError: () => set({ error: null }),

  approvePlan: async (verification) => {
    const cmds = verification.map((c) => c.trim()).filter(Boolean);
    if (cmds.length === 0) {
      set({ error: "Enter at least one verification command to approve." });
      return;
    }
    const { prd, architecture } = get();
    if (!prd.trim() || !architecture.trim()) {
      set({ error: "Approve needs both a PRD and an architecture." });
      return;
    }
    set({ busy: "Approving plan…", error: null });
    try {
      const root = requireRoot();
      // Persist the plan so it reloads from git (§3.8) and the Dev agents can read it.
      await invoke("write_text_file", { path: `${root}/${PRD_PATH}`, content: prd });
      await invoke("write_text_file", { path: `${root}/${ARCH_PATH}`, content: architecture });
      // Optional Analyst brief + Technical Writer docs, when present.
      const { analystBrief, techDocs } = get();
      if (analystBrief.trim()) await invoke("write_text_file", { path: `${root}/${BRIEF_PATH}`, content: analystBrief });
      if (techDocs.trim()) await invoke("write_text_file", { path: `${root}/${TECHDOCS_PATH}`, content: techDocs });
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
      await invoke("approve_plan", { verification: cmds });
      // Land on SHARD — the next step is breaking the plan into stories (the board
      // is empty until the SM shards), not the (empty) execution board.
      set({ verification: cmds, phase: "SHARD", busy: null, needsReplan: false });
      toast("Plan signed off — shard it into stories", "success");
    } catch (e) {
      set({ error: String(e), busy: null });
      toast("Sign-off failed", "error");
    }
  },

  shardNextStory: async (epic = 1) => {
    set({ busy: "Sharding the next story (SM)…", error: null });
    try {
      const root = requireRoot();
      const apiKey = requireKey();
      const { prd, architecture, uxSpec } = get();
      const ids = useBmadStore.getState().stories.map((s) => s.id);
      const story = nextStoryNumber(epic, ids);
      const planContext =
        `# PRD\n\n${prd}\n\n---\n\n# Architecture\n\n${architecture}` +
        (uxSpec.trim() ? `\n\n---\n\n# UX / Design Spec\n\n${uxSpec}` : "");

      await generateStory(
        {
          callWithTool: (systemPrompt, userPrompt, tool) =>
            callTool({ apiKey, model: planningModel(), systemPrompt, userPrompt, tool }),
          writeFile: (relPath, content) =>
            invoke("write_text_file", { path: `${root}/${relPath}`, content }),
        },
        { systemPrompt: SM_SYSTEM_PROMPT, planContext, epic, story }
      );
      // The story file lands in docs/stories/; the watcher reconciles it onto the board.
      set({ busy: null });
      toast(`Story ${epic}.${story} sharded onto the board`, "success");
    } catch (e) {
      set({ error: String(e), busy: null });
      toast("Sharding failed", "error");
    }
  },

  shardBacklog: async (epic = 1) => {
    set({ busy: "Sharding the full lifecycle backlog (SM)…", error: null });
    try {
      const root = requireRoot();
      const apiKey = requireKey();
      const { prd, architecture, uxSpec } = get();
      const ids = useBmadStore.getState().stories.map((s) => s.id);
      const start = nextStoryNumber(epic, ids);
      const planContext =
        `# PRD\n\n${prd}\n\n---\n\n# Architecture\n\n${architecture}` +
        (uxSpec.trim() ? `\n\n---\n\n# UX / Design Spec\n\n${uxSpec}` : "");

      const toolInput = await callTool({
        apiKey,
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
      set({ busy: null });
      toast(`Sharded ${stories.length} stories across the lifecycle`, "success");
    } catch (e) {
      set({ error: String(e), busy: null });
      toast("Backlog sharding failed", "error");
    }
  },

  dispatchStory: async (epic, story, opts) => {
    const key = `${epic}.${story}`;
    const silent = opts?.silent ?? false;
    // Fresh log for this run; the sink appends streamed output (capped). Mark the
    // story active so the UI shows it as genuinely running (vs. an orphaned one).
    // In parallel mode (silent) the caller owns the `busy` banner.
    set((s) => ({
      busy: silent ? s.busy : `Dispatching story ${epic}.${story}…`,
      error: null,
      logs: { ...s.logs, [key]: "" },
      active: { ...s.active, [key]: true },
    }));
    const onOutput = (chunk: string) => {
      aiLog(`story ${key}`, chunk);
      set((s) => {
        const next = (s.logs[key] ?? "") + chunk;
        const capped = next.length > 200_000 ? next.slice(next.length - 200_000) : next;
        return { logs: { ...s.logs, [key]: capped } };
      });
    };
    try {
      const root = requireRoot();

      // Find the story file (docs/stories/{epic}.{story}.{slug}.md) and read it.
      const storyPath = await findStoryPath(root, epic, story);
      if (!storyPath) throw new Error(`No story file for ${epic}.${story} — shard it first.`);
      const storyMarkdown = await invoke<string>("read_file", { path: storyPath });

      // Inject the shared Context Store (architecture + .cadre/context) so every
      // parallel agent builds against the same interfaces and decisions.
      const alwaysFiles = opts?.context ?? (await loadSharedContext(root));
      const prompt = composeDispatchPrompt({
        systemPrompt: DEV_SYSTEM_PROMPT,
        storyMarkdown,
        alwaysFiles,
      });

      // Resolve the model + per-agent env for the selected fleet provider. The
      // claude CLI runs every model; non-Claude providers just point it at their
      // Anthropic-compatible endpoint via env (§3.3).
      const provider = getProvider(get().fleetProvider);
      let token = await secretGet(provider.secretKey);
      if (!token && provider.id === "claude") {
        token = useSettingsStore.getState().anthropicApiKey || null;
      }
      if (!token) {
        throw new Error(`No API key for ${provider.name} — add it in the fleet model picker.`);
      }
      const { env, model: providerModel } = resolveAgentEnv(provider, token, fleetModelOverride() || provider.defaultModel);
      // Native Claude CLI: let it use its own default model (an unknown --model id can fail).
      const model = provider.id === "claude" ? undefined : providerModel;
      onOutput(`[cadre] dispatching on ${provider.name} (${model ?? "CLI default model"})\n`);

      // Route engine status writes through bmadStore so the board updates
      // optimistically (its own-write echo is then suppressed by the watcher).
      const setStatus = (e: number, s: number, status: Status) =>
        useBmadStore.getState().setStatus(e, s, status);
      const deps = { ...tauriOrchestratorDeps(onOutput), setStatus };

      const res = await runApprovedStory(deps, {
        root,
        epic,
        story,
        prompt,
        timeoutSecs: 1800,
        retriesOnNonZero: 0,
        model,
        env,
      });
      if (!silent) set({ busy: null });
      if (res.status === "Done") {
        // QA gate: run the adversarial code-review fleet on the worktree BEFORE
        // integrating. If it blocks, quarantine the story (Blocked) and don't merge
        // — the review has real authority, not just an advisory badge. Toggleable.
        if (useSettingsStore.getState().gateOnReview) {
          await get().reviewStory(epic, story);
          const reviews = get().codeReviews[key]?.reviews ?? [];
          if (aggregateReviews(reviews).verdict === "block") {
            await useBmadStore.getState().setStatus(epic, story, "Blocked");
            onOutput(`\n[cadre] code review BLOCKED ${epic}.${story} — not integrated; resolve the findings\n`);
            toast(`Story ${epic}.${story}: review blocked — not merged`, "error");
            return;
          }
        }
        // Merge the verified worktree back into main — serialized so parallel
        // stories integrate safely. On conflict, mark Blocked for the human (A).
        const integ = await withMergeLock(() =>
          integrateStory({ runGit: deps.runGit }, { root, epic, story })
        );
        if (integ.conflict) {
          await useBmadStore.getState().setStatus(epic, story, "Blocked");
          onOutput(`\n[cadre] merge conflict integrating ${epic}.${story} — Blocked for manual integration\n`);
          toast(`Story ${epic}.${story}: merge conflict — Blocked for you to integrate`, "error");
        } else {
          onOutput(`\n[cadre] integrated story ${epic}.${story} into main\n`);
          toast(`Story ${epic}.${story}: Done & integrated`, "success");
        }
      } else {
        toast(`Story ${epic}.${story}: ${res.status}`, "error");
      }
    } catch (e) {
      onOutput(`\n[cadre] dispatch error: ${String(e)}\n`);
      set((s) => ({ error: String(e), busy: silent ? s.busy : null }));
      toast(`Dispatch failed for ${epic}.${story}`, "error");
    } finally {
      // No longer running this session — an InProgress/InReview status left on the
      // board now reads as interrupted (see isInterrupted).
      set((s) => {
        const active = { ...s.active };
        delete active[key];
        return { active };
      });
    }
  },

  dispatchReady: async () => {
    try {
      const root = requireRoot();
      // Ready = not yet building/done: Draft (sharded) / Approved / Failed (retry).
      // Ready = gated for the fleet: Approved (draft-reviewed) or Failed (retry).
      const ready = useBmadStore
        .getState()
        .stories.filter((c) => c.status === "Approved" || c.status === "Failed");
      if (ready.length === 0) {
        toast("No approved stories to dispatch — approve a draft first", "info");
        return;
      }

      // Read each story's declared files to schedule file-disjoint parallel batches.
      const scheduled = await Promise.all(
        ready.map(async (c) => {
          const p = await findStoryPath(root, c.epic, c.story);
          const md = p ? await invoke<string>("read_file", { path: p }).catch(() => "") : "";
          return { id: c.id, files: parseStoryFiles(md) };
        })
      );
      const batches = scheduleParallel(scheduled, 4);
      const byId = new Map(ready.map((c) => [c.id, c]));

      // Load the shared Context Store once and reuse it for every agent.
      const context = await loadSharedContext(root);

      let done = 0;
      for (let b = 0; b < batches.length; b++) {
        const batch = batches[b];
        set({
          busy: `Building ${batch.length} stor${batch.length === 1 ? "y" : "ies"} in parallel — batch ${b + 1}/${batches.length}…`,
          error: null,
        });
        await Promise.all(
          batch.map((id) => {
            const c = byId.get(id)!;
            return get().dispatchStory(c.epic, c.story, { silent: true, context });
          })
        );
        done += batch.length;
      }
      set({ busy: null });
      toast(`Dispatched ${done} stor${done === 1 ? "y" : "ies"} across ${batches.length} batch${batches.length === 1 ? "" : "es"}`, "success");
    } catch (e) {
      set({ error: String(e), busy: null });
      toast("Parallel dispatch failed", "error");
    }
  },

  approveStory: async (epic, story) => {
    try {
      await useBmadStore.getState().setStatus(epic, story, "Approved");
      toast(`Story ${epic}.${story} approved — ready to dispatch`, "success");
    } catch (e) {
      set({ error: String(e) });
      toast(`Approve failed for ${epic}.${story}`, "error");
    }
  },

  reviewStory: async (epic, story) => {
    const key = `${epic}.${story}`;
    set((s) => ({ codeReviews: { ...s.codeReviews, [key]: { status: "reviewing" } }, error: null }));
    const onOutput = (chunk: string) => {
      aiLog(`review ${key}`, chunk);
      set((s) => {
        const next = (s.logs[key] ?? "") + chunk;
        const capped = next.length > 200_000 ? next.slice(next.length - 200_000) : next;
        return { logs: { ...s.logs, [key]: capped } };
      });
    };
    try {
      const root = requireRoot();
      // Same provider routing as dispatch — reviewers are agents on the fleet.
      const provider = getProvider(get().fleetProvider);
      let token = await secretGet(provider.secretKey);
      if (!token && provider.id === "claude") {
        token = useSettingsStore.getState().anthropicApiKey || null;
      }
      if (!token) throw new Error(`No API key for ${provider.name} — add it in the fleet model picker.`);
      const { env, model: providerModel } = resolveAgentEnv(provider, token, fleetModelOverride() || provider.defaultModel);
      // Native Claude CLI: let it use its own default model (an unknown --model id can fail).
      const model = provider.id === "claude" ? undefined : providerModel;
      onOutput(`[cadre] dispatching ${CODE_REVIEW_LENSES.length} adversarial reviewers on ${provider.name}\n`);

      const reviews = await reviewStoryFleet(tauriReviewFleetDeps(onOutput), {
        root,
        epic,
        story,
        lenses: CODE_REVIEW_LENSES,
        model,
        env,
      });
      const agg = aggregateReviews(reviews);
      onOutput(`[cadre] review fleet ${agg.verdict === "block" ? "BLOCKED" : "accepted"} (${agg.findingCount} findings)\n`);
      set((s) => ({ codeReviews: { ...s.codeReviews, [key]: { status: "done", reviews } } }));
      toast(
        `Review ${key}: ${agg.verdict === "block" ? `blocked (${agg.findingCount})` : "accepted"}`,
        agg.verdict === "block" ? "error" : "success"
      );
    } catch (e) {
      set((s) => ({ codeReviews: { ...s.codeReviews, [key]: { status: "done", reviews: [] } }, error: String(e) }));
      toast(`Review failed for ${key}`, "error");
    }
  },

  documentProject: async () => {
    set({ busy: "Analyzing the existing project (2 passes)…", error: null });
    const onOutput = (chunk: string) => {
      aiLog("analysis", chunk);
      set((s) => {
        const next = (s.logs["brownfield"] ?? "") + chunk;
        const capped = next.length > 200_000 ? next.slice(next.length - 200_000) : next;
        return { logs: { ...s.logs, brownfield: capped } };
      });
    };
    try {
      const root = requireRoot();
      const provider = getProvider(get().fleetProvider);
      let token = await secretGet(provider.secretKey);
      if (!token && provider.id === "claude") {
        token = useSettingsStore.getState().anthropicApiKey || null;
      }
      if (!token) throw new Error(`No API key for ${provider.name} — add it in the fleet model picker.`);
      const { env, model: providerModel } = resolveAgentEnv(provider, token, fleetModelOverride() || provider.defaultModel);
      // Native Claude CLI: let it use its own default model (an unknown --model id can fail).
      const model = provider.id === "claude" ? undefined : providerModel;

      const res = await documentProjectFleet(tauriReviewFleetDeps(onOutput), {
        root,
        passes: 2,
        model,
        env,
      });
      // Ground the PM in the existing project (read back what the agent wrote).
      const content =
        res.content ||
        (await invoke<string>("read_file", { path: `${root}/${BROWNFIELD_DOC_PATH}` }).catch(() => ""));
      // Auto-detect the project's real test command to pre-fill sign-off later.
      const detectedVerify = await detectProjectVerify(root).catch(() => "");
      set({ projectContext: content, isBrownfield: false, detectedVerify, busy: null });
      toast("Project analyzed — the PM now has context", "success");
    } catch (e) {
      set({ error: String(e), busy: null });
      toast("Project analysis failed", "error");
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
    set({ busy: "Updating the architecture…", error: null });
    try {
      const root = requireRoot();
      const apiKey = requireKey();
      const prd = get().prd;

      // 1. Architect re-derives the architecture from the amended PRD.
      const arch = await planningTurn({
        apiKey,
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
      if (arch.document) set({ architecture: arch.document });

      // 2. If a UX spec exists, the Designer updates the spec + mockup.
      if (get().uxSpec.trim()) {
        set({ busy: "Updating the UX…" });
        const ux = await planningTurn({
          apiKey,
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
        if (ux.document) set({ uxSpec: ux.document });
        if (ux.mockup) set({ mockupHtml: ux.mockup });
      }

      // 3. Persist the refreshed plan to disk.
      set({ busy: "Writing the updated plan…" });
      const { architecture, uxSpec, mockupHtml } = get();
      await invoke("write_text_file", { path: `${root}/${PRD_PATH}`, content: prd });
      await invoke("write_text_file", { path: `${root}/${ARCH_PATH}`, content: architecture });
      if (uxSpec.trim()) await invoke("write_text_file", { path: `${root}/${UX_PATH}`, content: uxSpec });
      if (mockupHtml.trim()) await invoke("write_text_file", { path: `${root}/${MOCKUP_PATH}`, content: mockupHtml });

      // 4. Shard a story for the new scope (dispatch stays gated on re-approval).
      set({ busy: "Sharding a story for the new scope…" });
      await get().shardNextStory(1);

      // The plan is refreshed but must be RE-APPROVED by a human before dispatch.
      set({ busy: null });
      toast("Plan updated downstream — re-approve to dispatch", "info");
    } catch (e) {
      set({ error: String(e), busy: null });
      toast("Cascade failed", "error");
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
    const [prd, architecture, uxSpec, mockupHtml, poValidation, projectContext, analystBrief, techDocs] = await Promise.all([
      readOr(PRD_PATH),
      readOr(ARCH_PATH),
      readOr(UX_PATH),
      readOr(MOCKUP_PATH),
      readOr(PO_PATH),
      readOr(BROWNFIELD_DOC_PATH),
      readOr(BRIEF_PATH),
      readOr(TECHDOCS_PATH),
    ]);
    const approval = await invoke<PlanApproval | null>("get_plan_approval").catch(() => null);
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

    set((s) => ({
      prd: prd || s.prd,
      architecture: architecture || s.architecture,
      analystBrief: analystBrief || s.analystBrief,
      techDocs: techDocs || s.techDocs,
      uxSpec: uxSpec || s.uxSpec,
      mockupHtml: mockupHtml || s.mockupHtml,
      poValidation: poValidation || s.poValidation,
      projectContext: projectContext || s.projectContext,
      isBrownfield,
      verification: approval?.verification ?? s.verification,
      // Approved on reload: go to FLEET if stories already exist (mid-execution),
      // else SHARD (break the plan down) — matching approvePlan's landing.
      phase: approved
        ? useBmadStore.getState().stories.length > 0
          ? "FLEET"
          : "SHARD"
        : s.phase,
    }));
  },
}));
