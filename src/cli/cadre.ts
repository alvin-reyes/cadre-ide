#!/usr/bin/env node
/**
 * `cadre` — the headless CLI twin of the Cadre desktop IDE's execute lifecycle.
 *
 * It runs the SAME engine the GUI runs (dispatch → verify → review gate →
 * integrate), driven by real `claude` CLI agents, real `git`, and real files, via
 * the Node deps in `./nodeDeps` (the twin of the app's `tauriDeps`). No GUI, no
 * new engine logic — it mirrors `useCadre.dispatchStory`'s control flow.
 *
 * Commands:
 *   cadre run [projectDir] [--auto]   dispatch every Approved story through the full flow
 *   cadre status [projectDir]         print the board (id · title · status)
 *
 * Auth: agents inherit this process's environment, so the user's `claude` login
 * powers dispatch and review — no API key is injected.
 */

import { readdir } from "node:fs/promises";
import { resolve, join } from "node:path";

import { boardStories, parseStoryFilename, storyId, type StoryCard } from "../lib/engine/board";
import type { Status } from "../lib/engine/status";
import { composeDispatchPrompt, type AlwaysFile } from "../lib/engine/dispatch";
import { runApprovedStory } from "../lib/engine/orchestrator";
import { integrateStory } from "../lib/engine/integrate";
import { reviewStory, aggregateReviews, type ReviewLens } from "../lib/engine/reviewFleet";
import { parseRepos, resolveRepoPath, findRepo } from "../lib/engine/repos";
import { parseStoryRepo } from "../lib/engine/shard";
import {
  nodeOrchestratorDeps,
  nodeReviewFleetDeps,
  setStatus,
  getStatus,
  getPlanApproval,
  runGit,
  readFile,
  type OutputSink,
} from "./nodeDeps";

// The Dev-agent persona — kept in sync with useCadre.ts's DEV_SYSTEM_PROMPT.
const DEV_SYSTEM_PROMPT = `You are the Dev agent. Implement the assigned story test-first: write the failing test, then the minimal code to make it pass. Follow the project's standards. Do NOT mark the story done — Cadre runs the verification command and decides.

SHARED CONTEXT: other stories build in parallel with you. If you create or change something other stories must agree on — a shared interface, type, API contract, config key, or an important decision — record it in a short Markdown file under \`.cadre/context/\` (e.g. \`.cadre/context/auth-api.md\`). Keep those files small and factual. Before inventing a shared contract, check what's already in \`.cadre/context/\` and reuse it. This is how parallel and later agents stay consistent.`;

// The adversarial review lenses. Kept in sync with lib/planning/review.ts's
// CODE_REVIEW_LENSES; inlined here so the CLI doesn't pull the desktop app's
// browser-only module graph (Anthropic SDK / zustand stores) into a Node build.
const CODE_REVIEW_LENSES: ReviewLens[] = [
  {
    lens: "correctness",
    prompt:
      "You are an ADVERSARIAL code reviewer focused on CORRECTNESS. Read the diff and try to BREAK it: logic errors, off-by-ones, unhandled edge cases, missing error handling, race conditions, broken invariants. Default to BLOCK on any real bug.",
  },
  {
    lens: "security",
    prompt:
      "You are an ADVERSARIAL code reviewer focused on SECURITY. Hunt for: injection, hardcoded secrets, missing authz/authn, unsafe deserialization, path traversal, SSRF, unvalidated input, and leaked data. Default to BLOCK on any real risk.",
  },
  {
    lens: "story-fit",
    prompt:
      "You are an ADVERSARIAL code reviewer checking the diff AGAINST THE STORY. Does it actually satisfy every acceptance criterion? Are there missing tests, gold-plating, or scope drift? Was the failing test truly written first? Default to BLOCK if the story isn't genuinely met.",
  },
];

const DISPATCH_TIMEOUT_SECS = 1800;

function log(msg = ""): void {
  process.stdout.write(msg + "\n");
}

/** Reconstruct the board from disk: story files reveal cards, state files their Status. */
async function readBoard(root: string): Promise<StoryCard[]> {
  const cards = new Map<string, StoryCard>();

  // docs/stories/{epic}.{story}.{slug}.md → a card (default Draft until a state file says otherwise).
  let storyFiles: string[] = [];
  try {
    storyFiles = await readdir(join(root, "docs", "stories"));
  } catch {
    /* no stories dir yet */
  }
  for (const name of storyFiles) {
    const loc = parseStoryFilename(name);
    if (!loc) continue;
    const title = loc.slug.replace(/[-_.]+/g, " ").replace(/\bstory\b/gi, "").replace(/\s+/g, " ").trim();
    cards.set(storyId(loc.epic, loc.story), {
      id: storyId(loc.epic, loc.story),
      epic: loc.epic,
      story: loc.story,
      title,
      status: "Draft",
    });
  }

  // .cadre/state/{epic}.{story}.json → the authoritative Status.
  for (const card of cards.values()) {
    const status = await getStatus(root, card.epic, card.story);
    if (status) card.status = status;
  }

  return boardStories({ stories: Object.fromEntries(cards) });
}

/** The shared Context Store (`.cadre/context/*.md`) injected into every agent. */
async function loadSharedContext(root: string): Promise<AlwaysFile[]> {
  const files: AlwaysFile[] = [];
  const dir = join(root, ".cadre", "context");
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return files;
  }
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    try {
      const content = await readFile(join(dir, name));
      if (content.trim()) files.push({ path: `.cadre/context/${name}`, content });
    } catch {
      /* skip unreadable */
    }
  }
  return files;
}

async function findStoryPath(root: string, epic: number, story: number): Promise<string | null> {
  const dir = join(root, "docs", "stories");
  const prefix = `${epic}.${story}.`;
  try {
    const names = await readdir(dir);
    const hit = names.find((n) => n.startsWith(prefix) && n.endsWith(".md"));
    return hit ? join(dir, hit) : null;
  } catch {
    return null;
  }
}

interface RunOutcome {
  id: string;
  title?: string;
  status: Status;
  note?: string;
}

/**
 * Run one Approved story through the full lifecycle — the headless mirror of
 * useCadre.dispatchStory: dispatch a real agent on a `story/<e>.<s>` worktree →
 * engine verifies → adversarial review gate → integrate → Done | Blocked.
 */
async function runOneStory(root: string, card: StoryCard): Promise<RunOutcome> {
  const { epic, story } = card;
  const onOutput: OutputSink = (chunk) => process.stdout.write(chunk);

  const storyPath = await findStoryPath(root, epic, story);
  if (!storyPath) {
    return { id: card.id, title: card.title, status: "Failed", note: "no story file — shard it first" };
  }
  const storyMarkdown = await readFile(storyPath);

  // Resolve the story's target repo (single-repo projects → { main, "." } → root).
  const repoId = parseStoryRepo(storyMarkdown);
  const manifest = await readFile(join(root, "cadre.json")).catch(() => "");
  const repos = parseRepos(manifest);
  const repoPath = resolveRepoPath(root, findRepo(repos, repoId).path);

  const alwaysFiles = await loadSharedContext(root);
  const prompt = composeDispatchPrompt({ systemPrompt: DEV_SYSTEM_PROMPT, storyMarkdown, alwaysFiles });

  log(`\n── Story ${card.id}${card.title ? ` "${card.title}"` : ""} ─────────────────────────────`);
  log(`[cadre] dispatching Dev agent on the story worktree (claude, CLI login)`);

  const deps = nodeOrchestratorDeps(root, onOutput);
  const res = await runApprovedStory(deps, {
    root,
    repoPath,
    repoId,
    epic,
    story,
    prompt,
    timeoutSecs: DISPATCH_TIMEOUT_SECS,
    retriesOnNonZero: 0,
  });

  if (res.status !== "Done") {
    log(`\n[cadre] story ${card.id} ended ${res.status} — not integrated`);
    return { id: card.id, title: card.title, status: res.status };
  }

  // QA gate: adversarial review fleet on the verified worktree BEFORE integrating.
  log(`\n[cadre] dispatching ${CODE_REVIEW_LENSES.length} adversarial reviewers`);
  const reviews = await reviewStory(nodeReviewFleetDeps(onOutput), {
    root,
    repoId,
    epic,
    story,
    lenses: CODE_REVIEW_LENSES,
  });
  const agg = aggregateReviews(reviews);
  log(`\n[cadre] review fleet ${agg.verdict === "block" ? "BLOCKED" : "accepted"} (${agg.findingCount} findings)`);
  if (agg.verdict === "block") {
    await setStatus(root, epic, story, "Blocked");
    return { id: card.id, title: card.title, status: "Blocked", note: "code review blocked — not integrated" };
  }

  // Merge the verified worktree back into main. On conflict → Blocked for the human.
  const integ = await integrateStory({ runGit }, { root, repoPath, epic, story });
  if (integ.conflict) {
    await setStatus(root, epic, story, "Blocked");
    log(`[cadre] merge conflict integrating ${card.id} — Blocked for manual integration`);
    return { id: card.id, title: card.title, status: "Blocked", note: "merge conflict — Blocked" };
  }
  log(`[cadre] integrated story ${card.id} into main`);
  return { id: card.id, title: card.title, status: "Done" };
}

async function cmdRun(projectDir: string, auto: boolean): Promise<number> {
  const root = resolve(projectDir);
  log(`cadre run — project: ${root}`);

  const approval = await getPlanApproval(root);
  if (!approval || !approval.approved || approval.verification.length === 0) {
    log(
      "\n[cadre] PLAN gate: no approved plan with a frozen verification command " +
        `(.cadre/approvals/plan.json). Approve the plan in the desktop app first.`
    );
    return 1;
  }

  const board = await readBoard(root);
  const approved = board.filter((c) => c.status === "Approved");
  if (approved.length === 0) {
    log("\n[cadre] no Approved stories to dispatch — approve a draft first.");
    return 0;
  }
  log(`[cadre] ${approved.length} Approved stor${approved.length === 1 ? "y" : "ies"} to run${auto ? " (--auto: continue past failures)" : ""}`);

  const outcomes: RunOutcome[] = [];
  for (const card of approved) {
    try {
      const outcome = await runOneStory(root, card);
      outcomes.push(outcome);
      // Without --auto, stop the queue at the first story that doesn't reach Done
      // (fail-fast). With --auto, continue through every Approved story.
      if (!auto && outcome.status !== "Done") {
        log(`\n[cadre] --auto not set: stopping after ${card.id} (${outcome.status}).`);
        break;
      }
    } catch (e) {
      log(`\n[cadre] error running ${card.id}: ${String(e)}`);
      outcomes.push({ id: card.id, title: card.title, status: "Failed", note: String(e) });
      await setStatus(root, card.epic, card.story, "Failed").catch(() => {});
      if (!auto) break;
    }
  }

  log("\n══ Summary ══════════════════════════════════════════");
  for (const o of outcomes) {
    log(`  ${o.status.padEnd(10)} ${o.id}${o.title ? `  ${o.title}` : ""}${o.note ? `  — ${o.note}` : ""}`);
  }
  const done = outcomes.filter((o) => o.status === "Done").length;
  log(`\n  ${done}/${outcomes.length} integrated.`);
  return outcomes.every((o) => o.status === "Done") ? 0 : 1;
}

async function cmdStatus(projectDir: string): Promise<number> {
  const root = resolve(projectDir);
  const board = await readBoard(root);
  if (board.length === 0) {
    log(`No stories found under ${join(root, "docs", "stories")}.`);
    return 0;
  }
  const idW = Math.max(2, ...board.map((c) => c.id.length));
  const titleW = Math.max(5, ...board.map((c) => (c.title ?? "").length));
  log(`${"ID".padEnd(idW)}  ${"TITLE".padEnd(titleW)}  STATUS`);
  log(`${"-".repeat(idW)}  ${"-".repeat(titleW)}  ------`);
  for (const c of board) {
    log(`${c.id.padEnd(idW)}  ${(c.title ?? "").padEnd(titleW)}  ${c.status}`);
  }
  return 0;
}

function usage(): void {
  log("Usage:");
  log("  cadre run [projectDir] [--auto]   run every Approved story through the full lifecycle");
  log("  cadre status [projectDir]         print the board (id · title · status)");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const rest = argv.slice(1);
  const auto = rest.includes("--auto");
  const positional = rest.filter((a) => !a.startsWith("-"));
  const projectDir = positional[0] ?? process.cwd();

  let code = 0;
  if (cmd === "run") {
    code = await cmdRun(projectDir, auto);
  } else if (cmd === "status") {
    code = await cmdStatus(projectDir);
  } else {
    usage();
    code = cmd === undefined || cmd === "help" || cmd === "--help" || cmd === "-h" ? 0 : 1;
  }
  process.exitCode = code;
}

main().catch((e) => {
  log(`cadre: fatal: ${String(e)}`);
  process.exitCode = 1;
});
