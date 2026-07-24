import { describe, it, expect } from "vitest";
import {
  documentProject,
  composeDocumentPrompt,
  documentAllRepos,
  composeAggregateAnalysis,
  BROWNFIELD_DOC_PATH,
  type DocumentProjectDeps,
  type DocumentAllDeps,
  type OnboardRepo,
} from "./brownfield";

function makeDeps(cfg: { fileAfter?: (pass: number) => string }): {
  deps: DocumentProjectDeps;
  spawns: { args: string[]; cwd: string }[];
} {
  const spawns: { args: string[]; cwd: string }[] = [];
  let pass = 0;
  let current = "";
  const deps: DocumentProjectDeps = {
    spawnAgent: async (opts) => {
      spawns.push({ args: opts.args, cwd: opts.cwd });
      pass++;
      current = cfg.fileAfter ? cfg.fileAfter(pass) : `analysis after pass ${pass}`;
      return spawns.length;
    },
    waitForExit: async () => ({ exitCode: 0 }),
    readFile: async () => current,
  };
  return { deps, spawns };
}

describe("brownfield: document-project runs as agent loops, twice", () => {
  it("runs two passes by default, dispatching a claude -p analyst in the repo root", async () => {
    const { deps, spawns } = makeDeps({});
    const res = await documentProject(deps, { root: "/proj" });

    expect(res.passes).toBe(2);
    expect(spawns).toHaveLength(2);
    for (const s of spawns) {
      expect(s.args).toContain("-p");
      expect(s.args[0]).toBe("--dangerously-skip-permissions");
      expect(s.cwd).toBe("/proj");
    }
    expect(res.path).toBe(BROWNFIELD_DOC_PATH);
  });

  it("the first pass documents; the second reviews and hardens the prior draft", () => {
    const p1 = composeDocumentPrompt({ outPath: BROWNFIELD_DOC_PATH, pass: 1, passes: 2, prior: "" });
    expect(p1).toMatch(/read the whole repository/i);
    expect(p1).toContain(BROWNFIELD_DOC_PATH);

    const p2 = composeDocumentPrompt({
      outPath: BROWNFIELD_DOC_PATH,
      pass: 2,
      passes: 2,
      prior: "DRAFT-ONE-CONTENT",
    });
    expect(p2).toMatch(/adversarial/i);
    expect(p2).toContain("DRAFT-ONE-CONTENT"); // the second pass sees the first draft
    expect(p2).toMatch(/rewrite the FULL analysis/i);
  });

  it("honors a custom pass count", async () => {
    const { deps, spawns } = makeDeps({});
    const res = await documentProject(deps, { root: "/p", passes: 3 });
    expect(res.passes).toBe(3);
    expect(spawns).toHaveLength(3);
  });

  it("returns the final analysis content", async () => {
    const { deps } = makeDeps({ fileAfter: (p) => `pass-${p}-doc` });
    const res = await documentProject(deps, { root: "/p" });
    expect(res.content).toBe("pass-2-doc");
  });
});

// ---------------------------------------------------------------------------
// documentAllRepos tests
// ---------------------------------------------------------------------------

/** Build a fake DocumentAllDeps where each repo gets a fixed analysis string. */
function makeAllDeps(cfg: {
  analysisFor?: (repoPath: string) => string;
  verifyFor?: (repoPath: string) => string | null;
  failForPaths?: string[];
}): {
  deps: DocumentAllDeps;
  repoStarts: { repo: OnboardRepo; index: number; total: number }[];
  detectVerifyCalls: string[];
} {
  const repoStarts: { repo: OnboardRepo; index: number; total: number }[] = [];
  const detectVerifyCalls: string[] = [];

  // Track per-repo analysis content: the fake spawnAgent writes it, readFile returns it.
  const contentByRoot = new Map<string, string>();

  const deps: DocumentAllDeps = {
    spawnAgent: async (opts) => {
      if (cfg.failForPaths?.includes(opts.cwd)) {
        throw new Error(`simulated agent failure for ${opts.cwd}`);
      }
      const analysis = cfg.analysisFor ? cfg.analysisFor(opts.cwd) : `analysis for ${opts.cwd}`;
      contentByRoot.set(opts.cwd, analysis);
      return 1;
    },
    waitForExit: async () => ({ exitCode: 0 }),
    readFile: async (path) => {
      // path is `${root}/${BROWNFIELD_DOC_PATH}` — extract root
      const root = path.replace(`/${BROWNFIELD_DOC_PATH}`, "");
      return contentByRoot.get(root) ?? "";
    },
    detectVerify: async (repoRoot) => {
      detectVerifyCalls.push(repoRoot);
      return cfg.verifyFor ? cfg.verifyFor(repoRoot) : null;
    },
    onRepoStart: (repo, index, total) => {
      repoStarts.push({ repo, index, total });
    },
  };
  return { deps, repoStarts, detectVerifyCalls };
}

describe("documentAllRepos", () => {
  it("single repo: one analysis, onRepoStart called once, aggregate equals the single analysis", async () => {
    const repo: OnboardRepo = { id: "root", name: "MyApp", path: "/proj" };
    const { deps, repoStarts, detectVerifyCalls } = makeAllDeps({
      analysisFor: () => "the single analysis",
      verifyFor: () => "npm test",
    });

    const results = await documentAllRepos(deps, { repos: [repo] });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("root");
    expect(results[0].analysis).toBe("the single analysis");
    expect(results[0].detectedVerify).toBe("npm test");
    expect(repoStarts).toHaveLength(1);
    expect(repoStarts[0]).toEqual({ repo, index: 0, total: 1 });
    expect(detectVerifyCalls).toEqual(["/proj"]);

    const aggregate = composeAggregateAnalysis(results);
    expect(aggregate).toBe("the single analysis");
  });

  it("two repos: analyses preserved in order, detectVerify called per repo, onRepoStart called with correct index/total", async () => {
    const repoA: OnboardRepo = { id: "frontend", name: "Frontend", path: "/proj/frontend" };
    const repoB: OnboardRepo = { id: "backend", name: "Backend", path: "/proj/backend" };

    const { deps, repoStarts, detectVerifyCalls } = makeAllDeps({
      analysisFor: (p) => `analysis of ${p}`,
      verifyFor: (p) => (p.includes("frontend") ? "npm test" : "cargo test"),
    });

    const results = await documentAllRepos(deps, { repos: [repoA, repoB] });

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ id: "frontend", analysis: "analysis of /proj/frontend", detectedVerify: "npm test" });
    expect(results[1]).toMatchObject({ id: "backend", analysis: "analysis of /proj/backend", detectedVerify: "cargo test" });

    expect(repoStarts).toHaveLength(2);
    expect(repoStarts[0]).toMatchObject({ index: 0, total: 2 });
    expect(repoStarts[1]).toMatchObject({ index: 1, total: 2 });

    expect(detectVerifyCalls).toEqual(["/proj/frontend", "/proj/backend"]);
  });

  it("fail-soft: a repo whose analysis throws is captured as empty, the other repo still analyzed, and its verify (detected independently) survives", async () => {
    const repoA: OnboardRepo = { id: "good", name: "Good", path: "/proj/good" };
    const repoB: OnboardRepo = { id: "bad", name: "Bad", path: "/proj/bad" };

    const { deps } = makeAllDeps({
      analysisFor: (p) => `analysis of ${p}`,
      failForPaths: ["/proj/bad"],
      verifyFor: () => "npm test",
    });

    const results = await documentAllRepos(deps, { repos: [repoA, repoB] });

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ id: "good", analysis: "analysis of /proj/good", detectedVerify: "npm test" });
    // The analysis failed but detectVerify only reads manifests, so it still succeeds.
    expect(results[1]).toMatchObject({ id: "bad", analysis: "", detectedVerify: "npm test" });
  });

  it("composeAggregateAnalysis on all-failed multi repos emits headers without crashing", () => {
    const empty = [
      { id: "a", name: "A", path: "/a", analysis: "", detectedVerify: null },
      { id: "b", name: "B", path: "/b", analysis: "", detectedVerify: null },
    ];
    const md = composeAggregateAnalysis(empty);
    expect(md).toContain("# Project analysis (2 repos)");
    expect(md).toContain("## Repo: A (`/a`)");
    expect(md).toContain("## Repo: B (`/b`)");
  });
});

// ---------------------------------------------------------------------------
// composeAggregateAnalysis tests
// ---------------------------------------------------------------------------

describe("composeAggregateAnalysis", () => {
  it("single repo: returns analysis verbatim", () => {
    const analyses = [{ id: "root", name: "MyApp", path: "/proj", analysis: "the analysis", detectedVerify: null }];
    expect(composeAggregateAnalysis(analyses)).toBe("the analysis");
  });

  it("multiple repos: formats a header + per-repo sections", () => {
    const analyses = [
      { id: "fe", name: "Frontend", path: "/proj/fe", analysis: "fe analysis", detectedVerify: null },
      { id: "be", name: "Backend", path: "/proj/be", analysis: "be analysis", detectedVerify: null },
    ];
    const result = composeAggregateAnalysis(analyses);
    expect(result).toContain("# Project analysis (2 repos)");
    expect(result).toContain("## Repo: Frontend (`/proj/fe`)");
    expect(result).toContain("fe analysis");
    expect(result).toContain("## Repo: Backend (`/proj/be`)");
    expect(result).toContain("be analysis");
  });

  it("multi-repo sections appear in order", () => {
    const analyses = [
      { id: "a", name: "A", path: "/a", analysis: "first", detectedVerify: null },
      { id: "b", name: "B", path: "/b", analysis: "second", detectedVerify: null },
      { id: "c", name: "C", path: "/c", analysis: "third", detectedVerify: null },
    ];
    const result = composeAggregateAnalysis(analyses);
    const posA = result.indexOf("first");
    const posB = result.indexOf("second");
    const posC = result.indexOf("third");
    expect(posA).toBeLessThan(posB);
    expect(posB).toBeLessThan(posC);
  });
});
