import { describe, it, expect } from "vitest";
import { runApprovedStory, type OrchestratorDeps } from "./orchestrator";
import type { PlanApproval } from "./planApproval";

function makeDeps(approval: PlanApproval | null) {
  const verifyCommands: string[] = [];
  const deps: OrchestratorDeps = {
    getPlanApproval: async () => approval,
    setStatus: async () => {},
    runGit: async () => {},
    spawnAgent: async () => 1,
    waitForExit: async () => ({ exitCode: 0 }),
    runVerification: async (_cwd, command) => {
      verifyCommands.push(command);
      return { exitCode: 0, timedOut: false };
    },
  };
  return { deps, verifyCommands };
}

const input = { root: "/proj", repoPath: "/proj", repoId: "main", epic: 1, story: 1, prompt: "P", timeoutSecs: 60 };

describe("runApprovedStory", () => {
  it("refuses to dispatch when the plan is not approved", async () => {
    const { deps } = makeDeps(null);
    await expect(runApprovedStory(deps, input)).rejects.toThrow(/PLAN gate/);
  });

  it("refuses when approved but no verification command was frozen", async () => {
    const { deps } = makeDeps({ approved: true, verification: [] });
    await expect(runApprovedStory(deps, input)).rejects.toThrow(/PLAN gate/);
  });

  it("verifies against the FROZEN command from the approval, not a caller arg", async () => {
    const { deps, verifyCommands } = makeDeps({
      approved: true,
      verification: ["forge test", "slither ."],
    });
    const r = await runApprovedStory(deps, input);
    expect(r.status).toBe("Done");
    // both frozen steps were run, in order
    expect(verifyCommands).toEqual(["forge test", "slither ."]);
  });

  // --- multi-repo fail-closed tests ---

  it("throws for a non-default repoId absent from the frozen repoVerification map (post-approval repo)", async () => {
    const { deps } = makeDeps({
      approved: true,
      verification: ["npm test"],
      repoVerification: {},
    } as PlanApproval & { repoVerification: Record<string, string[]> });
    const nonDefaultInput = { ...input, repoPath: "/proj/api", repoId: "api" };
    await expect(runApprovedStory(deps, nonDefaultInput)).rejects.toThrow(
      /No frozen verify command for repo "api"/
    );
  });

  it("uses the repo's own frozen verify when repoId is present in repoVerification", async () => {
    const { deps, verifyCommands } = makeDeps({
      approved: true,
      verification: ["npm test"],
      repoVerification: { api: ["go test ./..."] },
    } as PlanApproval & { repoVerification: Record<string, string[]> });
    const apiInput = { ...input, repoPath: "/proj/api", repoId: "api" };
    const r = await runApprovedStory(deps, apiInput);
    expect(r.status).toBe("Done");
    expect(verifyCommands).toEqual(["go test ./..."]);
  });

  it("falls back to approval.verification for the default repoId when repoVerification is empty (backward-compat)", async () => {
    const { deps, verifyCommands } = makeDeps({
      approved: true,
      verification: ["npm test"],
      repoVerification: {},
    } as PlanApproval & { repoVerification: Record<string, string[]> });
    // repoId "main" (DEFAULT_REPO_ID) with empty repoVerification → global verify
    const r = await runApprovedStory(deps, input);
    expect(r.status).toBe("Done");
    expect(verifyCommands).toEqual(["npm test"]);
  });
});
