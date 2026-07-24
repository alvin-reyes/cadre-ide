import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import {
  syncStory as coreSyncStory,
  type GhRunner,
  type TrackerStory,
  type TrackerStatus,
} from "../lib/integrations/githubTracker";
import { reportError } from "../lib/reportError";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrackerConfig {
  enabled: boolean;
  repo: string;
}

/** Shape written to / read from `.cadre/tracker.json`. */
export interface TrackerFile extends TrackerConfig {
  /** key: `${epic}.${story}` → GitHub issue number */
  issues: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Pure helper — exported and unit-tested without Tauri
// ---------------------------------------------------------------------------

/**
 * Parse "owner/repo" from a git remote URL.
 *
 * Handles:
 *   git@github.com:owner/repo.git
 *   git@github.com:owner/repo
 *   https://github.com/owner/repo.git
 *   https://github.com/owner/repo
 *
 * Returns null for non-GitHub URLs, empty strings, or unrecognised shapes.
 */
export function parseRepoFromRemote(remoteUrl: string): string | null {
  if (!remoteUrl) return null;

  const url = remoteUrl.trim();

  // SSH form: git@github.com:owner/repo(.git)
  const sshMatch = url.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];

  // HTTPS form: https://github.com/owner/repo(.git)
  const httpsMatch = url.match(
    /^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?(?:\/)?$/
  );
  if (httpsMatch) return httpsMatch[1];

  return null;
}

// ---------------------------------------------------------------------------
// Persist helper
// ---------------------------------------------------------------------------

const trackerPath = (root: string) => `${root}/.cadre/tracker.json`;

const DEFAULT_FILE: TrackerFile = { enabled: false, repo: "", issues: {} };

async function readTrackerFile(root: string): Promise<TrackerFile> {
  try {
    const raw = await invoke<string>("read_file", { path: trackerPath(root) });
    const parsed = JSON.parse(raw) as Partial<TrackerFile>;
    return {
      enabled: parsed.enabled ?? false,
      repo: parsed.repo ?? "",
      issues: parsed.issues ?? {},
    };
  } catch {
    return { ...DEFAULT_FILE, issues: {} };
  }
}

async function writeTrackerFile(root: string, file: TrackerFile): Promise<void> {
  await invoke("write_text_file", {
    path: trackerPath(root),
    content: JSON.stringify(file, null, 2),
  });
}

// ---------------------------------------------------------------------------
// Zustand store
// ---------------------------------------------------------------------------

interface TrackerState {
  config: TrackerConfig;
  issues: Record<string, number>;
  /** null = not yet checked; true/false = gh auth status */
  ghReady: boolean | null;

  /** Read .cadre/tracker.json; auto-detect repo from git remote if repo is empty. */
  load: (root: string) => Promise<void>;

  /** Toggle the enabled flag and persist. */
  setEnabled: (root: string, on: boolean) => Promise<void>;

  /** Update the repo and persist. */
  setRepo: (root: string, repo: string) => Promise<void>;

  /** Run `gh auth status` and update ghReady. */
  checkGh: () => Promise<void>;

  /**
   * Sync a single story to GitHub Issues.
   * No-op when tracker is disabled or repo is not set.
   * Best-effort: errors are routed to reportError, never thrown past the store.
   */
  syncStory: (
    root: string,
    story: TrackerStory,
    status: TrackerStatus,
    verifyCmd?: string
  ) => Promise<void>;

  /** Sync all provided stories sequentially. */
  syncAll: (
    root: string,
    stories: Array<{ story: TrackerStory; status: TrackerStatus; verifyCmd?: string }>
  ) => Promise<void>;
}

export const useTrackerStore = create<TrackerState>((set, get) => ({
  config: { enabled: false, repo: "" },
  issues: {},
  ghReady: null,

  load: async (root: string) => {
    try {
      const file = await readTrackerFile(root);
      let repo = file.repo;

      // Auto-detect repo from git remote when not set
      if (!repo) {
        try {
          const result = await invoke<{
            stdout: string;
            stderr: string;
            exit_code: number | null;
            timed_out: boolean;
          }>("run_git", { cwd: root, args: ["remote", "get-url", "origin"] });
          const detected = parseRepoFromRemote(result.stdout.trim());
          if (detected) repo = detected;
        } catch (e) {
          reportError("github tracker", e);
        }
      }

      set({
        config: { enabled: file.enabled, repo },
        issues: file.issues,
      });
    } catch (e) {
      reportError("github tracker", e);
    }
  },

  setEnabled: async (root: string, on: boolean) => {
    const { config, issues } = get();
    const nextConfig: TrackerConfig = { ...config, enabled: on };
    try {
      await writeTrackerFile(root, { ...nextConfig, issues });
      set({ config: nextConfig });
    } catch (e) {
      reportError("github tracker", e);
    }
  },

  setRepo: async (root: string, repo: string) => {
    const { config, issues } = get();
    const nextConfig: TrackerConfig = { ...config, repo };
    try {
      await writeTrackerFile(root, { ...nextConfig, issues });
      set({ config: nextConfig });
    } catch (e) {
      reportError("github tracker", e);
    }
  },

  checkGh: async () => {
    try {
      const result = await invoke<{
        stdout: string;
        stderr: string;
        exit_code: number | null;
        timed_out: boolean;
      }>("run_gh", { cwd: ".", args: ["auth", "status"] });
      set({ ghReady: result.exit_code === 0 });
    } catch (e) {
      reportError("github tracker", e);
      set({ ghReady: false });
    }
  },

  syncStory: async (
    root: string,
    story: TrackerStory,
    status: TrackerStatus,
    verifyCmd?: string
  ) => {
    const { config, issues } = get();
    if (!config.enabled || !config.repo) return;

    const key = `${story.epic}.${story.story}`;
    const issueNumber = issues[key];

    const gh: GhRunner = (args: string[]) =>
      invoke<{
        stdout: string;
        stderr: string;
        exit_code: number | null;
        timed_out: boolean;
      }>("run_gh", { cwd: root, args }).then((r) => ({
        stdout: r.stdout,
        stderr: r.stderr,
        exitCode: r.exit_code ?? 1,
      }));

    try {
      const result = await coreSyncStory(gh, {
        repo: config.repo,
        story,
        status,
        verifyCmd,
        issueNumber,
      });

      // Persist the (possibly new) issue number
      const nextIssues = { ...issues, [key]: result.issueNumber };
      await writeTrackerFile(root, {
        ...config,
        issues: nextIssues,
      });
      set({ issues: nextIssues });
    } catch (e) {
      reportError("github tracker", e);
    }
  },

  syncAll: async (
    root: string,
    stories: Array<{ story: TrackerStory; status: TrackerStatus; verifyCmd?: string }>
  ) => {
    for (const { story, status, verifyCmd } of stories) {
      await get().syncStory(root, story, status, verifyCmd);
    }
  },
}));
