import { describe, it, expect } from "vitest";
import { generateStory } from "../planning/generateStory";
import { CREATE_STORY_TOOL } from "../planning/storyTool";
import { runApprovedStory, type OrchestratorDeps } from "./orchestrator";
import { composeDispatchPrompt } from "./dispatch";
import { emptyBoard, reconcile, boardStories, type BoardState } from "./board";
import type { PlanApproval } from "./planApproval";
import type { Status } from "./status";

/**
 * End-to-end integration of the disciplined loop, exercised through the REAL
 * engine modules (generateStory → runApprovedStory → runStory → dispatchStory →
 * verifyStory → board) with in-memory fakes for the SDK, git, PTY, verification,
 * and filesystem. These assert the invariants the whole product rests on:
 *   - the engine drives every status transition; the agent never writes Done
 *   - Done requires the engine to actually RUN the frozen verification command
 *   - the verification command comes from the human approval, not the caller
 *   - no approval ⇒ no dispatch (PLAN gate)
 *   - a crashed agent fails WITHOUT a misleading verification pass
 *   - each story is isolated on its own worktree/branch
 */

interface VerifyOutcome {
  exitCode: number | null;
  timedOut: boolean;
}

interface World {
  statusLog: { epic: number; story: number; status: Status }[];
  verifyCalls: { cwd: string; command: string }[];
  gitCalls: string[][];
  spawned: number;
  board: BoardState;
}

function makeWorld(cfg: {
  agentExit?: number | null;
  approval?: PlanApproval | null;
  verify?: (command: string, callIndex: number) => VerifyOutcome;
  /** reconcile status writes into the board, mimicking the file watcher */
  reconcileBoard?: boolean;
}): { world: World; deps: OrchestratorDeps } {
  const world: World = {
    statusLog: [],
    verifyCalls: [],
    gitCalls: [],
    spawned: 0,
    board: emptyBoard(),
  };
  const agentExit = cfg.agentExit === undefined ? 0 : cfg.agentExit;
  const approval =
    cfg.approval === undefined ? { approved: true, verification: ["npm test"] } : cfg.approval;
  const verify = cfg.verify ?? (() => ({ exitCode: 0, timedOut: false }));
  let verifyIndex = 0;

  const deps: OrchestratorDeps = {
    setStatus: async (epic, story, status) => {
      world.statusLog.push({ epic, story, status });
      if (cfg.reconcileBoard) {
        world.board = reconcile(world.board, {
          kind: "state",
          filename: `${epic}.${story}.json`,
          content: JSON.stringify({ status }),
        });
      }
    },
    runGit: async (args: string[]) => {
      world.gitCalls.push(args);
    },
    spawnAgent: async () => {
      world.spawned++;
      return 1;
    },
    waitForExit: async () => ({ exitCode: agentExit }),
    runVerification: async (cwd: string, command: string) => {
      world.verifyCalls.push({ cwd, command });
      return verify(command, verifyIndex++);
    },
    getPlanApproval: async () => approval,
  };
  return { world, deps };
}

const baseInput = (over: Partial<Parameters<typeof runApprovedStory>[1]> = {}): Parameters<typeof runApprovedStory>[1] => ({
  root: "/proj",
  repoPath: "/proj",
  repoId: "main",
  epic: 1,
  story: 1,
  prompt: "implement the story test-first",
  timeoutSecs: 60,
  ...over,
});

describe("e2e: the disciplined loop", () => {
  it("happy path: dispatch → engine verifies → Done, with the exact transition order", async () => {
    const { world, deps } = makeWorld({});
    const res = await runApprovedStory(deps, baseInput());

    expect(res.status).toBe("Done");
    // The engine drove every transition, in order.
    expect(world.statusLog.map((s) => s.status)).toEqual(["InProgress", "InReview", "Done"]);
    // Done was written ONLY after a real verification ran.
    expect(world.verifyCalls).toHaveLength(1);
    expect(world.verifyCalls[0].command).toBe("npm test");
  });

  it("Done is never reached without the engine running verification", async () => {
    const { world, deps } = makeWorld({});
    await runApprovedStory(deps, baseInput());
    const doneIdx = world.statusLog.findIndex((s) => s.status === "Done");
    // Some verification call happened before Done was written.
    expect(doneIdx).toBeGreaterThan(-1);
    expect(world.verifyCalls.length).toBeGreaterThan(0);
  });

  it("failing verification ⇒ Failed (agent finished clean, tests red)", async () => {
    const { world, deps } = makeWorld({ verify: () => ({ exitCode: 1, timedOut: false }) });
    const res = await runApprovedStory(deps, baseInput());

    expect(res.status).toBe("Failed");
    expect(world.statusLog.map((s) => s.status)).toEqual(["InProgress", "InReview", "Failed"]);
    expect(world.verifyCalls).toHaveLength(1);
  });

  it("a crashed agent Fails WITHOUT running verification (no misleading pass)", async () => {
    const { world, deps } = makeWorld({ agentExit: 1 });
    const res = await runApprovedStory(deps, baseInput());

    expect(res.status).toBe("Failed");
    // Straight InProgress → Failed; never reached InReview.
    expect(world.statusLog.map((s) => s.status)).toEqual(["InProgress", "Failed"]);
    // Critically: verification was NOT run against stale/HEAD code.
    expect(world.verifyCalls).toHaveLength(0);
  });

  it("a signal-killed agent (exitCode null) also Fails without verifying", async () => {
    const { world, deps } = makeWorld({ agentExit: null });
    const res = await runApprovedStory(deps, baseInput());
    expect(res.status).toBe("Failed");
    expect(world.verifyCalls).toHaveLength(0);
  });

  it("PLAN gate: no approval ⇒ dispatch throws and nothing runs", async () => {
    const { world, deps } = makeWorld({ approval: null });
    await expect(runApprovedStory(deps, baseInput())).rejects.toThrow(/PLAN gate/);
    expect(world.spawned).toBe(0);
    expect(world.statusLog).toHaveLength(0);
  });

  it("PLAN gate: approved but with no frozen command ⇒ still refused", async () => {
    const { deps } = makeWorld({ approval: { approved: false, verification: [] } });
    await expect(runApprovedStory(deps, baseInput())).rejects.toThrow(/PLAN gate/);
    const { deps: deps2 } = makeWorld({ approval: { approved: true, verification: [] } });
    await expect(runApprovedStory(deps2, baseInput())).rejects.toThrow(/PLAN gate/);
  });

  it("trust loop: the command run is the FROZEN approval, not anything the caller passes", async () => {
    const { world, deps } = makeWorld({
      approval: { approved: true, verification: ["pnpm test && slither ."] },
    });
    await runApprovedStory(deps, baseInput());
    expect(world.verifyCalls.map((v) => v.command)).toEqual(["pnpm test && slither ."]);
  });

  it("multi-step verification: ALL must pass; the first failure short-circuits", async () => {
    const { world, deps } = makeWorld({
      approval: { approved: true, verification: ["build", "test", "audit"] },
      verify: (command) => ({ exitCode: command === "test" ? 1 : 0, timedOut: false }),
    });
    const res = await runApprovedStory(deps, baseInput());

    expect(res.status).toBe("Failed");
    // "build" then "test" ran; "audit" never reached (short-circuit on test's failure).
    expect(world.verifyCalls.map((v) => v.command)).toEqual(["build", "test"]);
  });

  it("timed-out verification counts as failure", async () => {
    const { deps } = makeWorld({ verify: () => ({ exitCode: null, timedOut: true }) });
    const res = await runApprovedStory(deps, baseInput());
    expect(res.status).toBe("Failed");
  });

  it("retry ceiling: flaky-then-green passes within the allowed retries", async () => {
    let n = 0;
    const { world, deps } = makeWorld({
      verify: () => ({ exitCode: n++ === 0 ? 1 : 0, timedOut: false }),
    });
    const res = await runApprovedStory(deps, baseInput({ retriesOnNonZero: 1 }));
    expect(res.status).toBe("Done");
    expect(world.verifyCalls).toHaveLength(2);
  });

  it("retry ceiling: still-red after the last retry ⇒ Failed", async () => {
    const { world, deps } = makeWorld({ verify: () => ({ exitCode: 1, timedOut: false }) });
    const res = await runApprovedStory(deps, baseInput({ retriesOnNonZero: 2 }));
    expect(res.status).toBe("Failed");
    expect(world.verifyCalls).toHaveLength(3); // 1 + 2 retries
  });

  it("worktree isolation: the story is dispatched on its own branch/worktree", async () => {
    const { world, deps } = makeWorld({});
    await runApprovedStory(deps, baseInput({ epic: 2, story: 3 }));
    // Dispatch is idempotent: it clears any stale worktree/branch, then adds fresh.
    // Worktree path is namespaced by repoId (the actual repo id from the story).
    expect(world.gitCalls).toContainEqual([
      "worktree",
      "add",
      "-b",
      "story/2.3",
      "/proj/.cadre/worktrees/main/2.3",
      "HEAD",
    ]);
    expect(world.gitCalls).toContainEqual(["worktree", "remove", "--force", "/proj/.cadre/worktrees/main/2.3"]);
    expect(world.gitCalls).toContainEqual(["branch", "-D", "story/2.3"]);
    expect(world.spawned).toBe(1);
  });
});

describe("e2e: SM sharding → board", () => {
  it("the SM shards a well-formed story file that lands on the board as Draft", async () => {
    const files = new Map<string, string>();
    const toolInput = {
      title: "User login",
      role: "returning user",
      action: "sign in with email + password",
      benefit: "I can access my account",
      acceptanceCriteria: ["rejects a bad password", "issues a session on success"],
      tasks: ["write the failing auth test", "implement sign-in"],
      devNotes: "Use the existing users table; hash with argon2.",
    };
    const { path, content } = await generateStory(
      {
        callWithTool: async (_sys, _user, tool) => {
          expect(tool).toBe(CREATE_STORY_TOOL);
          return toolInput;
        },
        writeFile: async (p, c) => {
          files.set(p, c);
        },
      },
      { systemPrompt: "sm", planContext: "PRD + architecture", epic: 1, story: 2 }
    );

    expect(path).toBe("docs/stories/1.2.user-login.md");
    expect(content.title).toBe("User login");
    const md = files.get(path)!;
    expect(md).toContain("# Story 1.2: User login");
    expect(md).toContain("**so that** I can access my account");
    expect(md).toContain("Draft");

    // The watcher reconciles the new story file → a Draft card with a humanized title.
    let board = reconcile(emptyBoard(), { kind: "story", filename: "1.2.user-login.md" });
    const card = boardStories(board)[0];
    expect(card.id).toBe("1.2");
    expect(card.title).toBe("user login");
    expect(card.status).toBe("Draft");
  });
});

describe("e2e: full pipeline — shard, dispatch, watch the board go Done", () => {
  it("a sharded story dispatched cleanly ends Done on the reconciled board", async () => {
    // 1. SM shards the story; the board picks it up as Draft.
    const files = new Map<string, string>();
    await generateStory(
      {
        callWithTool: async () => ({
          title: "Health check",
          role: "operator",
          action: "hit /healthz",
          benefit: "I know the service is up",
          acceptanceCriteria: ["returns 200"],
          tasks: ["test /healthz", "add the route"],
          devNotes: "Express app in src/server.ts.",
        }),
        writeFile: async (p, c) => {
          files.set(p, c);
        },
      },
      { systemPrompt: "sm", planContext: "ctx", epic: 1, story: 1 }
    );

    // 2. Dispatch through the real orchestrator; setStatus reconciles into the board.
    const { world, deps } = makeWorld({ reconcileBoard: true });
    world.board = reconcile(world.board, { kind: "story", filename: "1.1.health-check.md" });
    expect(boardStories(world.board)[0].status).toBe("Draft");

    const res = await runApprovedStory(deps, baseInput());

    // 3. The board reflects the engine's verified outcome.
    expect(res.status).toBe("Done");
    expect(boardStories(world.board)[0].status).toBe("Done");
    expect(boardStories(world.board)[0].title).toBe("health check");
  });
});

describe("e2e: the dispatch prompt carries the discipline", () => {
  it("tells the agent to go test-first and NOT self-report Done", () => {
    const prompt = composeDispatchPrompt({
      systemPrompt: "You are the Dev agent.",
      storyMarkdown: "# Story 1.1",
      alwaysFiles: [{ path: "STANDARDS.md", content: "no any" }],
    });
    expect(prompt).toContain("test-first");
    expect(prompt).toMatch(/do NOT mark the story done/i);
    expect(prompt).toContain("STANDARDS.md");
    expect(prompt).toContain("# Story 1.1");
  });
});
