import { emptyBoard, type BoardState, type StoryCard } from "./board";
import type { LensReview } from "./reviewFleet";
import type { Phase } from "../../cadre/components/PhaseStepper";
import type { ProjectMode } from "./projectMode";
import type { MaintainTask } from "../maintain/tasks";

/** One persistent agent slot in the team pool. */
export interface AgentSlot {
  agentId: string;
  currentStory: string | null;
  status: "idle" | "working" | "verifying";
  /** Role assigned to this slot. Legacy numeric slots (agent-0…) are implicitly "dev". */
  role?: "dev" | "qa" | "devops";
}

export interface BmadSlice {
  board: BoardState;
  stories: StoryCard[];
  watchError: string | null;
}

export function emptyBmadSlice(): BmadSlice {
  return { board: emptyBoard(), stories: [], watchError: null };
}

/**
 * The per-project fleet state held by useCadre. Everything that describes ONE
 * project's plan + live execution lives here, keyed by root in the projects map.
 * useCadre keeps a mirror of the active slice as its top-level fields so every
 * existing selector keeps working unchanged. (busy/error are per-project via the
 * mirror so cross-project banner leaks are impossible; fleetProvider stays global.)
 */
export interface CadreSlice {
  phase: Phase;
  prd: string;
  architecture: string;
  analystBrief: string;
  techDocs: string;
  opsDoc: string;
  uxSpec: string;
  mockupHtml: string;
  poValidation: string;
  projectContext: string;
  isBrownfield: boolean;
  /** True only while the brownfield analysis agent is running (drives the onboard
   *  spinner) — distinct from `busy`, which any async action sets. */
  analyzingBrownfield: boolean;
  detectedVerify: string;
  verification: string[];
  needsReplan: boolean;
  logs: Record<string, string>;
  codeReviews: Record<string, { status: "reviewing" | "done"; reviews?: LensReview[] }>;
  active: Record<string, boolean>;
  /** Persistent role-fleet agent slots (QA, DevOps, Dev-N). */
  agentSlots: AgentSlot[];
  /** Per-agent accumulated output log, keyed by agentId. */
  agentLogs: Record<string, string>;
  /** Human-readable status while an async action runs for this project (null = idle). */
  busy: string | null;
  /** Last error message for this project (null = none). */
  error: string | null;
  /** Build (greenfield plan/shard/dispatch) vs Maintain (existing app, ad-hoc tasks). */
  mode: ProjectMode;
  /** True right after opening a project until the user picks Build vs Maintain. */
  modeChoicePending: boolean;
  /** Maintenance/support tasks dispatched for this project (Maintain mode). */
  tasks: MaintainTask[];
}

export function emptyCadreSlice(): CadreSlice {
  return {
    phase: "PLAN",
    prd: "",
    architecture: "",
    analystBrief: "",
    techDocs: "",
    opsDoc: "",
    uxSpec: "",
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
    busy: null,
    error: null,
    mode: "build",
    modeChoicePending: false,
    tasks: [],
  };
}

export function updateSlice<T>(
  map: Record<string, T>,
  root: string,
  patch: Partial<T>,
  empty: () => T
): Record<string, T> {
  const base = map[root] ?? empty();
  return { ...map, [root]: { ...base, ...patch } };
}

export function mirrorBmad(projects: Record<string, BmadSlice>, activeRoot: string | null) {
  const s = (activeRoot && projects[activeRoot]) || emptyBmadSlice();
  return { projectRoot: activeRoot, board: s.board, stories: s.stories, watchError: s.watchError };
}

/** The active project's slice fields, or empty defaults when no project is active. */
export function mirrorCadre(
  projects: Record<string, CadreSlice>,
  activeRoot: string | null
): CadreSlice {
  const s = (activeRoot && projects[activeRoot]) || emptyCadreSlice();
  return {
    phase: s.phase,
    prd: s.prd,
    architecture: s.architecture,
    analystBrief: s.analystBrief,
    techDocs: s.techDocs,
    opsDoc: s.opsDoc,
    uxSpec: s.uxSpec,
    mockupHtml: s.mockupHtml,
    poValidation: s.poValidation,
    projectContext: s.projectContext,
    isBrownfield: s.isBrownfield,
    analyzingBrownfield: s.analyzingBrownfield,
    detectedVerify: s.detectedVerify,
    verification: s.verification,
    needsReplan: s.needsReplan,
    logs: s.logs,
    codeReviews: s.codeReviews,
    active: s.active,
    agentSlots: s.agentSlots,
    agentLogs: s.agentLogs,
    busy: s.busy,
    error: s.error,
    mode: s.mode,
    modeChoicePending: s.modeChoicePending,
    tasks: s.tasks,
  };
}
