import type { DispatchDeps } from "./dispatch";

/**
 * Brownfield onboarding (§7): when a user opens an EXISTING, non-Cadre project,
 * a PM/Analyst agent loop reads the whole codebase and documents it so the
 * planning fleet has real context (BMAD's document-project). It runs in TWO
 * passes — the second reviews and hardens the first — so the context is thorough,
 * not a first-glance guess. Like every other agent, this is a `claude -p` loop
 * that reads the real files; side effects are injected for testability.
 */

export interface DocumentProjectDeps {
  spawnAgent: DispatchDeps["spawnAgent"];
  waitForExit: (ptyId: number) => Promise<{ exitCode: number | null }>;
  readFile: (path: string) => Promise<string>;
}

export interface DocumentProjectInput {
  root: string;
  /** number of passes (default 2 — document, then review+harden) */
  passes?: number;
  model?: string;
  env?: Record<string, string>;
}

export const BROWNFIELD_DOC_PATH = "docs/brownfield-analysis.md";

export function composeDocumentPrompt(input: {
  outPath: string;
  pass: number;
  passes: number;
  prior: string;
}): string {
  const { outPath, pass, passes, prior } = input;
  if (pass === 1) {
    return [
      "You are the PM/Analyst onboarding an EXISTING project you did not build. Read the whole repository to understand it — explore the tree, read the key source files, configs, and docs.",
      "",
      `Write a thorough analysis to \`${outPath}\` in Markdown covering: ## Overview, ## Tech Stack, ## Architecture (with a Mermaid component diagram), ## Modules & Responsibilities, ## Data Model, ## How it Builds/Tests/Runs, ## Notable Risks & Tech Debt, ## Open Questions.`,
      "Be concrete and cite real files/paths. Write the file, then stop.",
    ].join("\n");
  }
  return [
    `You are an ADVERSARIAL reviewer doing pass ${pass} of ${passes} on the project analysis at \`${outPath}\`. The current draft is below.`,
    "",
    "Re-read the actual repository and BREAK the draft: find where it is wrong, vague, missing modules, missing risks, or contradicts the real code. Then rewrite the FULL analysis, corrected and expanded, back to the same file. Do not lose correct detail; add what's missing. Write the file, then stop.",
    "",
    "## Current draft",
    prior,
  ].join("\n");
}

/** Run the document-project analyst as agent loops, `passes` times, refining each pass. */
export async function documentProject(
  deps: DocumentProjectDeps,
  input: DocumentProjectInput
): Promise<{ path: string; passes: number; content: string }> {
  const passes = input.passes ?? 2;
  const outAbs = `${input.root}/${BROWNFIELD_DOC_PATH}`;

  for (let pass = 1; pass <= passes; pass++) {
    const prior = pass > 1 ? await deps.readFile(outAbs).catch(() => "") : "";
    const prompt = composeDocumentPrompt({ outPath: BROWNFIELD_DOC_PATH, pass, passes, prior });
    const args = input.model
      ? ["--dangerously-skip-permissions", "-p", prompt, "--model", input.model]
      : ["--dangerously-skip-permissions", "-p", prompt];
    const ptyId = await deps.spawnAgent({ command: "claude", args, cwd: input.root, env: input.env });
    await deps.waitForExit(ptyId);
  }

  const content = await deps.readFile(outAbs).catch(() => "");
  return { path: BROWNFIELD_DOC_PATH, passes, content };
}

// ---------------------------------------------------------------------------
// Multi-repo orchestrator
// ---------------------------------------------------------------------------

/** A repo whose path has already been resolved to an absolute path. */
export interface OnboardRepo {
  id: string;
  name: string;
  /** Absolute path to the repo root. */
  path: string;
}

export interface DocumentAllInput {
  repos: OnboardRepo[];
  passes?: number;
  model?: string;
  env?: Record<string, string>;
}

export interface DocumentAllDeps extends DocumentProjectDeps {
  /** Auto-detect the verify command for a repo root. Returns null when unknown. */
  detectVerify: (repoRoot: string) => Promise<string | null>;
  /** Called before each repo is analyzed; useful for progress UI. */
  onRepoStart?: (repo: OnboardRepo, index: number, total: number) => void;
}

export interface RepoAnalysis {
  id: string;
  name: string;
  path: string;
  analysis: string;
  detectedVerify: string | null;
}

/**
 * Analyze each registered repo by running `documentProject` per repo (which writes
 * that repo's own `docs/brownfield-analysis.md`) and detecting its verify command.
 * FAIL-SOFT: a repo that throws is captured as `{ analysis: "", detectedVerify: null }`
 * so a single bad repo doesn't abort the whole run.
 */
export async function documentAllRepos(
  deps: DocumentAllDeps,
  input: DocumentAllInput
): Promise<RepoAnalysis[]> {
  const total = input.repos.length;
  const results: RepoAnalysis[] = [];

  for (let i = 0; i < total; i++) {
    const repo = input.repos[i];
    deps.onRepoStart?.(repo, i, total);
    try {
      const [res, verify] = await Promise.all([
        documentProject(deps, { root: repo.path, passes: input.passes, model: input.model, env: input.env }),
        deps.detectVerify(repo.path),
      ]);
      results.push({ id: repo.id, name: repo.name, path: repo.path, analysis: res.content, detectedVerify: verify });
    } catch {
      results.push({ id: repo.id, name: repo.name, path: repo.path, analysis: "", detectedVerify: null });
    }
  }

  return results;
}

/**
 * Compose a single markdown string from per-repo analyses.
 * - Single repo: returns its analysis verbatim (byte-identical to today's single-repo behavior).
 * - Multiple repos: joins under a `# Project analysis (N repos)` header with per-repo `## Repo:` sections.
 */
export function composeAggregateAnalysis(analyses: RepoAnalysis[]): string {
  if (analyses.length === 1) {
    return analyses[0].analysis;
  }
  const sections = analyses.map(
    (a) => `## Repo: ${a.name} (\`${a.path}\`)\n\n${a.analysis}`
  );
  return `# Project analysis (${analyses.length} repos)\n\n${sections.join("\n\n")}`;
}
