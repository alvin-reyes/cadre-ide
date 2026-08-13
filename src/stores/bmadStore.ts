import { create } from "zustand";
import { invoke, Channel } from "@tauri-apps/api/core";
import {
  emptyBoard,
  reconcile,
  applyStatus,
  boardStories,
  type BoardState,
  type StoryCard,
} from "../lib/engine/board";
import type { Status } from "../lib/engine/status";
import { scaffoldFiles } from "../lib/projectScaffold";
import { reportError } from "../lib/reportError";
import {
  emptyBmadSlice,
  mirrorBmad,
  updateSlice,
  type BmadSlice,
} from "../lib/engine/projectSlices";
import { useTrackerStore } from "./trackerStore";
import { useMcpTrackerStore } from "./mcpTrackerStore";
import { shouldSync, type TrackerStatus } from "../lib/integrations/mcpTracker";
import { useCadre } from "../cadre/useCadre";
import { detectProjectMode } from "../lib/engine/projectMode";
import { loadModeChoice } from "../lib/maintain/modePreference";

/**
 * bmadStore: the live Fleet board. Opens a project, hydrates the board from the
 * committed files (§3.8 reload-from-git), and streams filesystem changes through
 * the pure `reconcile` (board.ts). The engine writes disk; this reflects it.
 *
 * Task 4: holds a `projects` map (many open projects) and an `activeRoot`
 * pointer. The top-level `projectRoot / board / stories / watchError` fields
 * are a derived mirror of the active project's slice so every existing selector
 * keeps working unchanged.
 */

type WatchEvt =
  | { type: "created"; path: string }
  | { type: "changed"; path: string; content: string }
  | { type: "removed"; path: string }
  | { type: "error"; message: string };

interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

interface BmadState {
  // --- per-project map ---
  projects: Record<string, BmadSlice>;
  activeRoot: string | null;
  // --- mirror fields (derived from projects[activeRoot]) ---
  projectRoot: string | null;
  board: BoardState;
  stories: StoryCard[];
  /** set if a directory watch failed to register — the board may be static */
  watchError: string | null;
  // --- actions ---
  openProject: (root: string) => Promise<void>;
  /** Scaffold a fresh Cadre project (git + cadre.json + docs) at `path`, then open it. */
  newProject: (path: string) => Promise<void>;
  /**
   * Authoritative status write: updates the board immediately (so the UI is
   * live) AND writes the engine-owned state file. The watcher echo of this
   * write is then suppressed by `is_own_write`, leaving the watcher to surface
   * only external changes. The engine's setStatus dep should route through here.
   */
  setStatus: (epic: number, story: number, status: Status, root?: string) => Promise<void>;
  setActiveProject: (root: string) => void;
  closeProject: (root: string) => void;
}

export const useBmadStore = create<BmadState>((set, get) => {
  // Re-derive the active mirror from the projects map. Call after every slice change.
  function syncMirror() {
    set((s) => mirrorBmad(s.projects, s.activeRoot));
  }

  // Push a reconciled board into a SPECIFIC project's slice (by root), then mirror.
  function pushRoot(root: string, board: BoardState) {
    set((s) => ({
      projects: updateSlice(s.projects, root, { board, stories: boardStories(board) }, emptyBmadSlice),
    }));
    syncMirror();
  }

  // State files are authoritative Status — always read the file (a "created"
  // event carries no content, and atomic rename can fire either kind).
  // `root` is captured at watcher registration time — never use get().activeRoot here.
  async function reconcileState(root: string, path: string) {
    try {
      const content = await invoke<string>("read_file", { path });
      // Write-origin suppression (§5): if this is cadre's own write, the board
      // was already updated by setStatus — don't re-process the echo. Only
      // genuine external changes fall through to reconcile.
      if (await invoke<boolean>("is_own_write", { root, path, content })) return;
      const currentBoard = get().projects[root]?.board ?? emptyBoard();
      pushRoot(root, reconcile(currentBoard, { kind: "state", filename: basename(path), content }));
    } catch {
      /* file vanished mid-read; ignore */
    }
  }

  function reconcileStory(root: string, path: string) {
    const currentBoard = get().projects[root]?.board ?? emptyBoard();
    pushRoot(root, reconcile(currentBoard, { kind: "story", filename: basename(path) }));
  }

  return {
    // --- initial state ---
    projects: {},
    activeRoot: null,
    projectRoot: null,
    board: emptyBoard(),
    stories: [],
    watchError: null,

    setActiveProject: (root: string) => {
      set({ activeRoot: root });
      syncMirror();
    },

    closeProject: (root: string) => {
      set((s) => {
        const projects = { ...s.projects };
        delete projects[root];
        const roots = Object.keys(projects);
        const activeRoot =
          s.activeRoot === root ? (roots[roots.length - 1] ?? null) : s.activeRoot;
        return { projects, activeRoot };
      });
      syncMirror();
    },

    setStatus: async (epic: number, story: number, status: Status, root: string | undefined | null = get().activeRoot) => {
      if (!root) return;
      const slice = get().projects[root];
      if (!slice) return;
      // Optimistic board update, then the engine writes the authoritative file.
      const prev = slice.board;
      pushRoot(root, applyStatus(prev, epic, story, status));
      try {
        await invoke("story_set_status", { root, epic, story, status });
        // Best-effort push to the GitHub tracker (no-op unless enabled for this project).
        const tracker = useTrackerStore.getState();
        if (tracker.config.enabled && tracker.config.repo) {
          const st = get().projects[root]?.stories?.find((s) => s.epic === epic && s.story === story);
          const title = st?.title ?? `Story ${epic}.${story}`;
          // Compute the frozen verification command for this project so the Done
          // comment cites the exact command that passed (Finding 2).
          const verification = useCadre.getState().projects[root]?.verification;
          const verifyCmd = (verification ?? []).filter(Boolean).join(" && ") || undefined;
          void tracker.syncStory(root, { epic, story, title }, status, verifyCmd).catch(() => {});
        }
        // Best-effort push to the MCP tracker (no-op unless a tracker connection is designated).
        if (shouldSync(status as TrackerStatus)) {
          const st = get().projects[root]?.stories?.find((s) => s.epic === epic && s.story === story);
          const title = st?.title ?? `Story ${epic}.${story}`;
          const verification = useCadre.getState().projects[root]?.verification;
          const verifyCmd = (verification ?? []).filter(Boolean).join(" && ") || undefined;
          // Full story-status snapshot for this project so syncStory can
          // aggregate per-epic status when the epic is linked to a parent
          // ticket (syncStory filters to the changed story's epic itself).
          const epicStatuses = (get().projects[root]?.stories ?? []).map((s) => ({
            epic: s.epic,
            story: s.story,
            status: s.status as TrackerStatus,
          }));
          void useMcpTrackerStore
            .getState()
            .syncStory(root, { epic, story, title }, status as TrackerStatus, verifyCmd, epicStatuses)
            .catch(() => {});
        }
      } catch (e) {
        // Rejected (e.g. an illegal edge): roll back so the board doesn't drift
        // ahead of the on-disk state that never changed.
        pushRoot(root, prev);
        throw e;
      }
    },

    newProject: async (path: string) => {
      const name = basename(path) || "cadre-project";
      const manifest = JSON.stringify({ cadre: "0.1", name, createdAt: new Date().toISOString() }, null, 2);
      // write_text_file creates parent dirs, so this also creates the project folder.
      await invoke("write_text_file", { path: `${path}/cadre.json`, content: manifest });
      await invoke("write_text_file", { path: `${path}/README.md`, content: `# ${name}\n\nA Cadre project. Disciplined AI development — verified, not vibed.\n` });
      await invoke("write_text_file", { path: `${path}/docs/.gitkeep`, content: "" });
      // Default scaffold: CLAUDE.md, llms.txt, and the BMAD agent prompts.
      for (const f of scaffoldFiles(name)) {
        await invoke("write_text_file", { path: `${path}/${f.path}`, content: f.content });
      }
      // git repo with an initial commit (dispatch needs a HEAD to branch from).
      const idc = ["-c", "user.name=Cadre", "-c", "user.email=cadre@local"];
      await invoke("run_git", { cwd: path, args: ["init"] }).catch(() => {});
      await invoke("run_git", { cwd: path, args: [...idc, "add", "-A"] }).catch(() => {});
      await invoke("run_git", { cwd: path, args: [...idc, "commit", "-m", "cadre: init"] }).catch(() => {});
      await get().openProject(path);
      // openProject requests a mode choice, but a freshly scaffolded project is
      // always a Build project — choose it outright (no picker).
      useCadre.getState().setActiveProject(path);
      useCadre.getState().chooseMode("build");
    },

    openProject: async (root: string) => {
      // Cadre dispatches each story into an isolated git worktree, so the project
      // folder must be a git repository. Rather than block a non-git folder, we
      // just initialize one — opening should be frictionless. (This runs FIRST,
      // before open_project / seeding / watchers, so the folder is a valid repo
      // before anything reads .cadre/state or docs/stories.)
      interface RunResult { exit_code: number | null; stdout: string; stderr: string; timed_out: boolean }
      let isGit = false;
      try {
        const res = await invoke<RunResult>("run_git", {
          cwd: root,
          args: ["rev-parse", "--is-inside-work-tree"],
        });
        isGit = res.exit_code === 0 && res.stdout.trim() === "true";
      } catch {
        // run_git threw (e.g. git not installed, or the path isn't a repo yet).
        isGit = false;
      }
      if (!isGit) {
        // Auto-initialize. We do NOT auto-commit the working tree (an existing
        // folder may contain node_modules/large or sensitive files) — `git init`
        // is enough to open and to work in Maintenance; the user commits when ready.
        try {
          const res = await invoke<RunResult>("run_git", { cwd: root, args: ["init"] });
          if (res.exit_code !== 0) throw new Error(res.stderr || "git init failed");
        } catch {
          // Throw for the caller to surface — every caller already reports (or shows)
          // the failure, so reporting here too would double the toast + AI Log entry.
          throw new Error(
            `Could not initialize a git repository in "${root}". Make sure git is ` +
            `installed and the folder is writable, then try again.`
          );
        }
      }

      await invoke("open_project", { root });

      // Resolve the project's working mode (Build vs Maintain). A repo that
      // already carries greenfield plan artifacts (a PRD, or sharded stories) is
      // a Build project being resumed; a repo with neither is an existing app
      // opened for Maintenance/Support. detectProjectMode owns the policy.
      const docsEntries = await invoke<{ path: string; is_dir: boolean }[]>("list_directory", {
        path: `${root}/docs`,
      }).catch(() => []);
      const hasPrd = docsEntries.some((e) => !e.is_dir && e.path.endsWith("prd.md"));
      const storyEntries = await invoke<{ path: string; is_dir: boolean }[]>("list_directory", {
        path: `${root}/docs/stories`,
      }).catch(() => []);
      const hasStories = storyEntries.some((e) => !e.is_dir && e.path.endsWith(".md"));
      useCadre.getState().setActiveProject(root);
      // If the user already chose a mode for this project, apply it silently. Only
      // a project we've never seen shows the ModeChoiceDialog — suggesting the
      // detected mode but letting the user confirm. Opening never forces a mode.
      const remembered = loadModeChoice(root);
      if (remembered) {
        useCadre.getState().chooseMode(remembered);
      } else {
        useCadre.getState().requestModeChoice(detectProjectMode({ hasPrd, hasStories }));
      }

      // Seed the slice for this project and make it active, then sync the mirror.
      set((s) => ({
        projects: { ...s.projects, [root]: emptyBmadSlice() },
        activeRoot: root,
      }));
      syncMirror();

      const stateDir = `${root}/.cadre/state`;
      const storyDir = `${root}/docs/stories`;

      // Hydrate from what's already committed — write into THIS root's slice.
      try {
        const entries = await invoke<DirEntry[]>("list_directory", { path: storyDir });
        for (const e of entries) if (!e.is_dir) reconcileStory(root, e.path);
      } catch {
        /* no stories yet */
      }
      try {
        const entries = await invoke<DirEntry[]>("list_directory", { path: stateDir });
        for (const e of entries) if (!e.is_dir) await reconcileState(root, e.path);
      } catch {
        /* no state yet */
      }

      // Live-watch both directories.
      // `root` is captured in the closure — background projects update their
      // own slice, never "whatever is currently active".
      const stateChannel = new Channel<WatchEvt>();
      stateChannel.onmessage = (evt) => {
        if (evt.type === "created" || evt.type === "changed") reconcileState(root, evt.path);
      };
      const storyChannel = new Channel<WatchEvt>();
      storyChannel.onmessage = (evt) => {
        if (evt.type === "created" || evt.type === "changed") reconcileStory(root, evt.path);
      };
      invoke("watch_directory", {
        dir: stateDir,
        extensions: ["json"],
        onEvent: stateChannel,
      }).catch((e) => {
        set((s) => ({
          projects: updateSlice(s.projects, root, { watchError: `state watch failed: ${e}` }, emptyBmadSlice),
        }));
        syncMirror();
        reportError("state watch", e);
      });
      invoke("watch_directory", {
        dir: storyDir,
        extensions: ["md"],
        onEvent: storyChannel,
      }).catch((e) => {
        set((s) => ({
          projects: updateSlice(s.projects, root, { watchError: `story watch failed: ${e}` }, emptyBmadSlice),
        }));
        syncMirror();
        reportError("story watch", e);
      });
    },
  };
});
