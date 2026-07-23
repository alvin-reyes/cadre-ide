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

/**
 * bmadStore: the live Fleet board. Opens a project, hydrates the board from the
 * committed files (§3.8 reload-from-git), and streams filesystem changes through
 * the pure `reconcile` (board.ts). The engine writes disk; this reflects it.
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
  projectRoot: string | null;
  board: BoardState;
  stories: StoryCard[];
  /** set if a directory watch failed to register — the board may be static */
  watchError: string | null;
  openProject: (root: string) => Promise<void>;
  /** Scaffold a fresh Cadre project (git + cadre.json + docs) at `path`, then open it. */
  newProject: (path: string) => Promise<void>;
  /**
   * Authoritative status write: updates the board immediately (so the UI is
   * live) AND writes the engine-owned state file. The watcher echo of this
   * write is then suppressed by `is_own_write`, leaving the watcher to surface
   * only external changes. The engine's setStatus dep should route through here.
   */
  setStatus: (epic: number, story: number, status: Status) => Promise<void>;
}

export const useBmadStore = create<BmadState>((set, get) => {
  function push(board: BoardState) {
    set({ board, stories: boardStories(board) });
  }

  // State files are authoritative Status — always read the file (a "created"
  // event carries no content, and atomic rename can fire either kind).
  async function reconcileState(path: string) {
    try {
      const content = await invoke<string>("read_file", { path });
      // Write-origin suppression (§5): if this is cadre's own write, the board
      // was already updated by setStatus — don't re-process the echo. Only
      // genuine external changes fall through to reconcile.
      if (await invoke<boolean>("is_own_write", { path, content })) return;
      push(
        reconcile(get().board, { kind: "state", filename: basename(path), content })
      );
    } catch {
      /* file vanished mid-read; ignore */
    }
  }

  function reconcileStory(path: string) {
    push(reconcile(get().board, { kind: "story", filename: basename(path) }));
  }

  return {
    projectRoot: null,
    board: emptyBoard(),
    stories: [],
    watchError: null,

    setStatus: async (epic: number, story: number, status: Status) => {
      // Optimistic board update, then the engine writes the authoritative file.
      const prev = get().board;
      push(applyStatus(prev, epic, story, status));
      try {
        await invoke("story_set_status", { epic, story, status });
      } catch (e) {
        // Rejected (e.g. an illegal edge): roll back so the board doesn't drift
        // ahead of the on-disk state that never changed.
        push(prev);
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
    },

    openProject: async (root: string) => {
      await invoke("open_project", { root });
      set({ projectRoot: root, board: emptyBoard(), stories: [], watchError: null });

      const stateDir = `${root}/.cadre/state`;
      const storyDir = `${root}/docs/stories`;

      // Hydrate from what's already committed.
      try {
        const entries = await invoke<DirEntry[]>("list_directory", { path: storyDir });
        for (const e of entries) if (!e.is_dir) reconcileStory(e.path);
      } catch {
        /* no stories yet */
      }
      try {
        const entries = await invoke<DirEntry[]>("list_directory", { path: stateDir });
        for (const e of entries) if (!e.is_dir) await reconcileState(e.path);
      } catch {
        /* no state yet */
      }

      // Live-watch both directories.
      const stateChannel = new Channel<WatchEvt>();
      stateChannel.onmessage = (evt) => {
        if (evt.type === "created" || evt.type === "changed") reconcileState(evt.path);
      };
      const storyChannel = new Channel<WatchEvt>();
      storyChannel.onmessage = (evt) => {
        if (evt.type === "created" || evt.type === "changed") reconcileStory(evt.path);
      };
      invoke("watch_directory", {
        dir: stateDir,
        extensions: ["json"],
        onEvent: stateChannel,
      }).catch((e) => set({ watchError: `state watch failed: ${e}` }));
      invoke("watch_directory", {
        dir: storyDir,
        extensions: ["md"],
        onEvent: storyChannel,
      }).catch((e) => set({ watchError: `story watch failed: ${e}` }));
    },
  };
});
