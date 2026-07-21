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
  openProject: (root: string) => Promise<void>;
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

    setStatus: async (epic: number, story: number, status: Status) => {
      // Optimistic board update, then the engine writes the authoritative file.
      push(applyStatus(get().board, epic, story, status));
      await invoke("story_set_status", { epic, story, status });
    },

    openProject: async (root: string) => {
      await invoke("open_project", { root });
      set({ projectRoot: root, board: emptyBoard(), stories: [] });

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
      }).catch(() => {});
      invoke("watch_directory", {
        dir: storyDir,
        extensions: ["md"],
        onEvent: storyChannel,
      }).catch(() => {});
    },
  };
});
