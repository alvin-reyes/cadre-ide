import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Phase } from "./components/PhaseStepper";
import { useBmadStore } from "../stores/bmadStore";
import { useSettingsStore } from "../stores/settingsStore";
import { callTool, planningTurn } from "../lib/planning/planningChat";
import { ARCHITECT_SYSTEM_PROMPT, DESIGN_SYSTEM_PROMPT } from "../lib/planning/personas";
import { generateStory } from "../lib/planning/generateStory";
import { runApprovedStory } from "../lib/engine/orchestrator";
import { reviewStory as reviewStoryFleet, aggregateReviews, type LensReview } from "../lib/engine/reviewFleet";
import { documentProject as documentProjectFleet, BROWNFIELD_DOC_PATH } from "../lib/engine/brownfield";
import { CODE_REVIEW_LENSES } from "../lib/planning/review";
import { tauriOrchestratorDeps, tauriReviewFleetDeps } from "../lib/engine/tauriDeps";
import { composeDispatchPrompt } from "../lib/engine/dispatch";
import { nextStoryNumber } from "../lib/engine/shard";
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

export const MODEL = "claude-sonnet-4-6";

const SM_SYSTEM_PROMPT = `You are the Scrum Master (SM). Turn the approved plan into the NEXT single implementation story via the create_story tool.

Prefer a small, vertically-sliced, independently testable story. Populate every field completely — the Dev agent works only from this story and reads nothing else, so put the relevant architecture, file paths, and standards into devNotes. Acceptance criteria must be concrete and testable; tasks must be TDD-first (write the failing test, then the code).`;

const DEV_SYSTEM_PROMPT = `You are the Dev agent. Implement the assigned story test-first: write the failing test, then the minimal code to make it pass. Follow the project's standards. Do NOT mark the story done — Cadre runs the verification command and decides.`;

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

interface CadreState {
  phase: Phase;
  /** the planning artifacts, as they form in the Planning Studio */
  prd: string;
  architecture: string;
  /** optional UX/design artifacts (Design tab) — spec + a live HTML mockup */
  uxSpec: string;
  mockupHtml: string;
  /** optional PO validation report (PO tab) — sign-off / gaps vs the PRD */
  poValidation: string;
  /** brownfield analysis of an existing project (grounds the PM), if generated */
  projectContext: string;
  /** the frozen verification command(s) once the plan is approved */
  verification: string[];
  /** true when the PRD/plan changed after approval — the fleet must re-approve (§5.1) */
  needsReplan: boolean;
  /** live agent + verification output, keyed by "epic.story" (streamed on dispatch) */
  logs: Record<string, string>;
  /** adversarial code-review results keyed by "epic.story" (the review fleet) */
  codeReviews: Record<string, { status: "reviewing" | "done"; reviews?: LensReview[] }>;
  /** which model provider the Dev fleet runs on (id from engine PROVIDERS) */
  fleetProvider: string;
  /** a human-readable status while an async action runs (null = idle) */
  busy: string | null;
  error: string | null;

  setPhase: (phase: Phase) => void;
  setPrd: (md: string) => void;
  setArchitecture: (md: string) => void;
  setUxSpec: (md: string) => void;
  setMockupHtml: (html: string) => void;
  setPoValidation: (md: string) => void;
  setFleetProvider: (id: string) => void;
  clearError: () => void;

  /** Freeze the verification command, write the plan to disk, unlock the fleet. */
  approvePlan: (verification: string[]) => Promise<void>;
  /** Run the SM to shard the next story for `epic` (default 1). */
  shardNextStory: (epic?: number) => Promise<void>;
  /** Dispatch a Dev agent for a story; Cadre verifies and writes the status. */
  dispatchStory: (epic: number, story: number) => Promise<void>;
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
  mockupHtml: "",
  poValidation: "",
  projectContext: "",
  verification: [],
  needsReplan: false,
  logs: {},
  codeReviews: {},
  fleetProvider: "claude",
  busy: null,
  error: null,

  setPhase: (phase) => set({ phase }),
  // Editing a plan artifact after approval marks the plan as needing re-approval.
  setPrd: (prd) => set((s) => ({ prd, needsReplan: s.verification.length > 0 ? true : s.needsReplan })),
  setArchitecture: (architecture) =>
    set((s) => ({ architecture, needsReplan: s.verification.length > 0 ? true : s.needsReplan })),
  setUxSpec: (uxSpec) => set((s) => ({ uxSpec, needsReplan: s.verification.length > 0 ? true : s.needsReplan })),
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
      set({ verification: cmds, phase: "FLEET", busy: null, needsReplan: false });
    } catch (e) {
      set({ error: String(e), busy: null });
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
            callTool({ apiKey, model: MODEL, systemPrompt, userPrompt, tool }),
          writeFile: (relPath, content) =>
            invoke("write_text_file", { path: `${root}/${relPath}`, content }),
        },
        { systemPrompt: SM_SYSTEM_PROMPT, planContext, epic, story }
      );
      // The story file lands in docs/stories/; the watcher reconciles it onto the board.
      set({ busy: null });
    } catch (e) {
      set({ error: String(e), busy: null });
    }
  },

  dispatchStory: async (epic, story) => {
    const key = `${epic}.${story}`;
    // Fresh log for this run; the sink appends streamed output (capped).
    set((s) => ({ busy: `Dispatching story ${epic}.${story}…`, error: null, logs: { ...s.logs, [key]: "" } }));
    const onOutput = (chunk: string) => {
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

      const prompt = composeDispatchPrompt({
        systemPrompt: DEV_SYSTEM_PROMPT,
        storyMarkdown,
        alwaysFiles: [],
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
      const { env, model } = resolveAgentEnv(provider, token, provider.defaultModel);
      onOutput(`[cadre] dispatching on ${provider.name} (${model})\n`);

      // Route engine status writes through bmadStore so the board updates
      // optimistically (its own-write echo is then suppressed by the watcher).
      const setStatus = (e: number, s: number, status: Status) =>
        useBmadStore.getState().setStatus(e, s, status);
      const deps = { ...tauriOrchestratorDeps(onOutput), setStatus };

      await runApprovedStory(deps, {
        root,
        epic,
        story,
        prompt,
        timeoutSecs: 1800,
        retriesOnNonZero: 0,
        model,
        env,
      });
      set({ busy: null });
    } catch (e) {
      set({ error: String(e), busy: null });
    }
  },

  reviewStory: async (epic, story) => {
    const key = `${epic}.${story}`;
    set((s) => ({ codeReviews: { ...s.codeReviews, [key]: { status: "reviewing" } }, error: null }));
    const onOutput = (chunk: string) => {
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
      const { env, model } = resolveAgentEnv(provider, token, provider.defaultModel);
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
    } catch (e) {
      set((s) => ({ codeReviews: { ...s.codeReviews, [key]: { status: "done", reviews: [] } }, error: String(e) }));
    }
  },

  documentProject: async () => {
    set({ busy: "Analyzing the existing project (2 passes)…", error: null });
    const onOutput = (chunk: string) => {
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
      const { env, model } = resolveAgentEnv(provider, token, provider.defaultModel);

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
      set({ projectContext: content, busy: null });
    } catch (e) {
      set({ error: String(e), busy: null });
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
        model: MODEL,
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
          model: MODEL,
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
    } catch (e) {
      set({ error: String(e), busy: null });
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
    const [prd, architecture, uxSpec, mockupHtml, poValidation, projectContext] = await Promise.all([
      readOr(PRD_PATH),
      readOr(ARCH_PATH),
      readOr(UX_PATH),
      readOr(MOCKUP_PATH),
      readOr(PO_PATH),
      readOr(BROWNFIELD_DOC_PATH),
    ]);
    const approval = await invoke<PlanApproval | null>("get_plan_approval").catch(() => null);
    const approved = !!approval?.approved && (approval?.verification?.length ?? 0) > 0;
    set((s) => ({
      prd: prd || s.prd,
      architecture: architecture || s.architecture,
      uxSpec: uxSpec || s.uxSpec,
      mockupHtml: mockupHtml || s.mockupHtml,
      poValidation: poValidation || s.poValidation,
      projectContext: projectContext || s.projectContext,
      verification: approval?.verification ?? s.verification,
      // If the plan was already approved in a prior session, jump to the fleet.
      phase: approved ? "FLEET" : s.phase,
    }));
  },
}));
