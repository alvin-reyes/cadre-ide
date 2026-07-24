import { storyBranch } from "./dispatch";

/**
 * Integrate a verified story's branch back into the main line. Called ONE AT A
 * TIME (serialized by the caller) after a story reaches Done in its worktree, so
 * parallel stories merge safely. Disjoint-file scheduling means most merges are
 * clean; on a conflict we abort and leave main untouched so the human can resolve
 * it — the caller marks the story Blocked (design choice A).
 */
export interface IntegrateDeps {
  /** run a git command in `cwd` (throws on non-zero exit) */
  runGit: (args: string[], cwd: string) => Promise<void>;
}

export interface IntegrateInput {
  root: string;
  /** the code repo where the story branch lives and where the merge runs */
  repoPath: string;
  epic: number;
  story: number;
}

export interface IntegrateResult {
  merged: boolean;
  conflict: boolean;
}

// A fixed identity so the merge commit never fails on an unconfigured repo.
const IDENT = ["-c", "user.name=Cadre", "-c", "user.email=cadre@local"];

export async function integrateStory(
  deps: IntegrateDeps,
  input: IntegrateInput
): Promise<IntegrateResult> {
  const branch = storyBranch(input.epic, input.story);
  const msg = `cadre: integrate story ${input.epic}.${input.story}`;
  try {
    await deps.runGit([...IDENT, "merge", "--no-ff", "-m", msg, branch], input.repoPath);
    return { merged: true, conflict: false };
  } catch {
    // Conflict (or other merge failure): abort so main stays clean for the human.
    try {
      await deps.runGit(["merge", "--abort"], input.repoPath);
    } catch {
      /* nothing to abort */
    }
    return { merged: false, conflict: true };
  }
}
