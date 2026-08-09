/**
 * evaluationStore — runs the background Guardian + Audit agents over a project's
 * current git changes and holds their findings for the top-bar notification bar.
 * Each agent runs headless (`claude -p`) in the project dir (inheriting the app's
 * claude.ai login) with a READ-ONLY tool allowlist (git + read/search only, no
 * --dangerously-skip-permissions), inspects the repo, and returns a JSON array of
 * findings (parseFindings). On-demand via evaluate(); the indicator drives the
 * optional interval.
 */
import { create } from "zustand";
import { tauriOrchestratorDeps, waitForExit } from "../lib/engine/tauriDeps";
import { parseFindings, promptFor, type EvalAgent, type Finding } from "../lib/maintain/evaluation";
import { aiLog } from "./aiLogStore";

function genId(): string {
  try { if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID(); } catch { /* fall through */ }
  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

async function runAgent(root: string, agent: EvalAgent): Promise<Finding[]> {
  let out = "";
  const deps = tauriOrchestratorDeps(root, (chunk) => { out += chunk; });
  try {
    // READ-ONLY: allow only git + read/search tools (no --dangerously-skip-permissions),
    // so a background reviewer can inspect the repo but never mutate it.
    const ptyId = await deps.spawnAgent({
      command: "claude",
      args: ["--allowedTools", "Bash(git:*),Read,Grep,Glob", "-p", promptFor(agent)],
      cwd: root,
    });
    await waitForExit(ptyId);
  } catch (e) {
    aiLog(agent, `evaluation failed: ${String(e)}\n`, "error");
    return [];
  }
  const at = Date.now();
  return parseFindings(out).map((r) => ({ id: genId(), root, agent, severity: r.severity, title: r.title, detail: r.detail, at }));
}

interface EvaluationStore {
  findings: Finding[];
  running: boolean;
  lastRunAt: number | null;
  panelOpen: boolean;
  evaluate: (root: string) => Promise<void>;
  dismiss: (id: string) => void;
  clearForRoot: (root: string) => void;
  setPanelOpen: (open: boolean) => void;
}

export const useEvaluationStore = create<EvaluationStore>((set, get) => ({
  findings: [],
  running: false,
  lastRunAt: null,
  panelOpen: false,

  evaluate: async (root) => {
    if (get().running) return;
    set({ running: true });
    try {
      const results = await Promise.all((["guardian", "audit"] as EvalAgent[]).map((a) => runAgent(root, a)));
      const fresh = results.flat();
      // Replace this project's findings with the fresh run; keep other projects'.
      const others = get().findings.filter((f) => f.root !== root);
      set({ findings: [...fresh, ...others], lastRunAt: Date.now() });
    } finally {
      set({ running: false });
    }
  },
  dismiss: (id) => set({ findings: get().findings.filter((f) => f.id !== id) }),
  clearForRoot: (root) => set({ findings: get().findings.filter((f) => f.root !== root) }),
  setPanelOpen: (open) => set({ panelOpen: open }),
}));
