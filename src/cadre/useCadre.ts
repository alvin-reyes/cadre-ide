import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Phase } from "./components/PhaseStepper";
import { useBmadStore } from "../stores/bmadStore";
import { useSettingsStore } from "../stores/settingsStore";
import { callTool } from "../lib/planning/planningChat";
import { generateStory } from "../lib/planning/generateStory";
import { runApprovedStory } from "../lib/engine/orchestrator";
import { tauriOrchestratorDeps } from "../lib/engine/tauriDeps";
import { composeDispatchPrompt } from "../lib/engine/dispatch";
import { nextStoryNumber } from "../lib/engine/shard";
import type { Status } from "../lib/engine/status";

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

interface CadreState {
  phase: Phase;
  /** the two planning artifacts, as they form in the Planning Studio */
  prd: string;
  architecture: string;
  /** the frozen verification command(s) once the plan is approved */
  verification: string[];
  /** a human-readable status while an async action runs (null = idle) */
  busy: string | null;
  error: string | null;

  setPhase: (phase: Phase) => void;
  setPrd: (md: string) => void;
  setArchitecture: (md: string) => void;
  clearError: () => void;

  /** Freeze the verification command, write the plan to disk, unlock the fleet. */
  approvePlan: (verification: string[]) => Promise<void>;
  /** Run the SM to shard the next story for `epic` (default 1). */
  shardNextStory: (epic?: number) => Promise<void>;
  /** Dispatch a Dev agent for a story; Cadre verifies and writes the status. */
  dispatchStory: (epic: number, story: number) => Promise<void>;
  /** Read a story's markdown (docs/stories/{epic}.{story}.*.md), or "" if none. */
  getStoryMarkdown: (epic: number, story: number) => Promise<string>;
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
  verification: [],
  busy: null,
  error: null,

  setPhase: (phase) => set({ phase }),
  setPrd: (prd) => set({ prd }),
  setArchitecture: (architecture) => set({ architecture }),
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
      // Freeze the verification command in engine-owned state (agents can't forge it).
      await invoke("approve_plan", { verification: cmds });
      set({ verification: cmds, phase: "FLEET", busy: null });
    } catch (e) {
      set({ error: String(e), busy: null });
    }
  },

  shardNextStory: async (epic = 1) => {
    set({ busy: "Sharding the next story (SM)…", error: null });
    try {
      const root = requireRoot();
      const apiKey = requireKey();
      const { prd, architecture } = get();
      const ids = useBmadStore.getState().stories.map((s) => s.id);
      const story = nextStoryNumber(epic, ids);
      const planContext = `# PRD\n\n${prd}\n\n---\n\n# Architecture\n\n${architecture}`;

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
    set({ busy: `Dispatching story ${epic}.${story}…`, error: null });
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

      // Route engine status writes through bmadStore so the board updates
      // optimistically (its own-write echo is then suppressed by the watcher).
      const setStatus = (e: number, s: number, status: Status) =>
        useBmadStore.getState().setStatus(e, s, status);
      const deps = { ...tauriOrchestratorDeps(), setStatus };

      await runApprovedStory(deps, {
        root,
        epic,
        story,
        prompt,
        timeoutSecs: 1800,
        retriesOnNonZero: 0,
      });
      set({ busy: null });
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
}));
