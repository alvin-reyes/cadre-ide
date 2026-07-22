import { describe, it, expect } from "vitest";
import {
  reviewStory,
  aggregateReviews,
  composeReviewPrompt,
  reviewMarkerPath,
  type ReviewFleetDeps,
  type ReviewLens,
} from "./reviewFleet";

const LENSES: ReviewLens[] = [
  { lens: "correctness", prompt: "find bugs" },
  { lens: "security", prompt: "find vulns" },
  { lens: "story-fit", prompt: "check the story" },
];

function makeDeps(cfg: {
  markers?: Record<string, string>; // lens → JSON the reviewer "wrote"
}): { deps: ReviewFleetDeps; spawns: { args: string[]; cwd: string }[] } {
  const spawns: { args: string[]; cwd: string }[] = [];
  const deps: ReviewFleetDeps = {
    spawnAgent: async (opts) => {
      spawns.push({ args: opts.args, cwd: opts.cwd });
      return spawns.length;
    },
    waitForExit: async () => ({ exitCode: 0 }),
    readFile: async (path) => {
      const lens = Object.keys(cfg.markers ?? {}).find((l) => path.endsWith(`.${l}.json`));
      if (lens && cfg.markers && cfg.markers[lens] !== undefined) return cfg.markers[lens];
      throw new Error("no marker");
    },
  };
  return { deps, spawns };
}

describe("review fleet: reviewers are dispatched agent loops", () => {
  it("dispatches one claude -p reviewer per lens, in the story worktree", async () => {
    const { deps, spawns } = makeDeps({
      markers: {
        correctness: JSON.stringify({ verdict: "accept", findings: [] }),
        security: JSON.stringify({ verdict: "accept", findings: [] }),
        "story-fit": JSON.stringify({ verdict: "accept", findings: [] }),
      },
    });
    await reviewStory(deps, { root: "/proj", epic: 1, story: 2, lenses: LENSES });

    expect(spawns).toHaveLength(3);
    for (const s of spawns) {
      expect(s.args[0]).toBe("-p");
      expect(s.cwd).toBe("/proj/.cadre/worktrees/1.2");
    }
  });

  it("reads + parses each lens's findings marker", async () => {
    const { deps } = makeDeps({
      markers: {
        correctness: JSON.stringify({
          verdict: "block",
          findings: [{ severity: "blocker", title: "off-by-one", detail: "loop overruns" }],
        }),
        security: JSON.stringify({ verdict: "accept", findings: [] }),
        "story-fit": JSON.stringify({
          verdict: "block",
          findings: [{ severity: "major", title: "missing test", detail: "AC2 untested" }],
        }),
      },
    });
    const reviews = await reviewStory(deps, { root: "/p", epic: 1, story: 1, lenses: LENSES });

    const correctness = reviews.find((r) => r.lens === "correctness")!;
    expect(correctness.verdict).toBe("block");
    expect(correctness.findings[0].title).toBe("off-by-one");
    expect(reviews.find((r) => r.lens === "security")!.verdict).toBe("accept");
  });

  it("a reviewer that writes NO findings file is a blocker, never a silent pass", async () => {
    const { deps } = makeDeps({
      markers: {
        correctness: JSON.stringify({ verdict: "accept", findings: [] }),
        // security + story-fit write nothing → readFile throws
      },
    });
    const reviews = await reviewStory(deps, { root: "/p", epic: 1, story: 1, lenses: LENSES });
    const security = reviews.find((r) => r.lens === "security")!;
    expect(security.verdict).toBe("block");
    expect(security.findings[0].title).toMatch(/no findings file/i);
  });

  it("bad severities are normalized, not trusted", async () => {
    const { deps } = makeDeps({
      markers: {
        correctness: JSON.stringify({
          verdict: "block",
          findings: [{ severity: "catastrophic", title: "x", detail: "y" }],
        }),
        security: JSON.stringify({ verdict: "accept", findings: [] }),
        "story-fit": JSON.stringify({ verdict: "accept", findings: [] }),
      },
    });
    const reviews = await reviewStory(deps, { root: "/p", epic: 1, story: 1, lenses: LENSES });
    expect(reviews.find((r) => r.lens === "correctness")!.findings[0].severity).toBe("major");
  });

  it("aggregate: blocked if ANY reviewer blocks; counts all findings", () => {
    const agg = aggregateReviews([
      { lens: "a", verdict: "accept", findings: [] },
      { lens: "b", verdict: "block", findings: [{ severity: "blocker", title: "t", detail: "d" }] },
      { lens: "c", verdict: "accept", findings: [{ severity: "minor", title: "t", detail: "d" }] },
    ]);
    expect(agg.verdict).toBe("block");
    expect(agg.findingCount).toBe(2);
  });

  it("aggregate: accept only when every reviewer accepts", () => {
    const agg = aggregateReviews([
      { lens: "a", verdict: "accept", findings: [] },
      { lens: "b", verdict: "accept", findings: [] },
    ]);
    expect(agg.verdict).toBe("accept");
  });

  it("the review prompt tells the agent to read the code and write the marker", () => {
    const marker = reviewMarkerPath("/p", 1, 1, "correctness");
    const prompt = composeReviewPrompt({ lens: "correctness", prompt: "find bugs" }, marker);
    expect(prompt).toContain("git diff");
    expect(prompt).toContain(marker);
    expect(prompt).toMatch(/write the file/i);
  });
});
