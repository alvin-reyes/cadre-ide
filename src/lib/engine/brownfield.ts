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
