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
 *   cadre plan "<brief>" [projectDir]        PM + Architect turns → docs/prd.md,
 *                                            docs/architecture.md, frozen plan approval
 *   cadre shard [projectDir]                 SM turn → the full lifecycle backlog (Draft)
 *   cadre approve [projectDir] [--all|<e.s>…] set stories Draft → Approved
 *   cadre build "<brief>" [projectDir] [--auto]  one-shot: plan → shard → approve → run
 *   cadre intake <ticketId> [projectDir] [--build]  fetch a tracker ticket → brief → plan
 *   cadre run [projectDir] [--auto]          dispatch every Approved story through the full flow
 *   cadre status [projectDir]                print the board (id · title · status)
 *   cadre connect <preset> [projectDir] [--token <t>] [--field K=V…] [--as-tracker]
 *                                            connect + probe an MCP server, save on success
 *   cadre connections [projectDir]           list configured MCP connections
 *   cadre disconnect <id> [projectDir]       remove an MCP connection
 *
 * Auth: execute agents inherit this process's environment, so the user's `claude`
 * login powers dispatch and review — no API key is injected. PLANNING (plan /
 * shard) instead uses the Anthropic API key resolved by `./planning`.
 */

import { readdir, writeFile as fsWriteFile, mkdir } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";

import { boardStories, parseStoryFilename, storyId, type StoryCard } from "../lib/engine/board";
import type { Status } from "../lib/engine/status";
import { composeDispatchPrompt, type AlwaysFile } from "../lib/engine/dispatch";
import { runApprovedStory } from "../lib/engine/orchestrator";
import { integrateStory } from "../lib/engine/integrate";
import { reviewStory, aggregateReviews, type ReviewLens } from "../lib/engine/reviewFleet";
import { parseRepos, resolveRepoPath, findRepo } from "../lib/engine/repos";
import { parseStoryRepo, shardStory, nextStoryNumber } from "../lib/engine/shard";
import { PM_SYSTEM_PROMPT, ARCHITECT_SYSTEM_PROMPT } from "../lib/planning/personas";
import { CREATE_BACKLOG_TOOL, backlogFromTool } from "../lib/planning/storyTool";
import { getPlanningKey, planningModel, callTool, planApproval, canApprove } from "./planning";
import {
  nodeOrchestratorDeps,
  nodeReviewFleetDeps,
  setStatus,
  getStatus,
  getPlanApproval,
  setPlanApproval,
  runGit,
  readFile,
  type OutputSink,
} from "./nodeDeps";
import { CATALOG, presetToConnection } from "../lib/mcp/catalog";
import { probeConnection } from "./mcp/client";
import {
  realNodeIo,
  readConnections,
  upsertConnection,
  removeConnection,
  setRoleNode,
  resolveTrackerEnvNode,
} from "./mcp/connectionsNode";
import { syncStoryNode, realRunSyncAgentNode, syncingSetStatus } from "./mcp/trackerSyncNode";
import { fetchTicketNode } from "./mcp/intakeNode";
import { ticketToBrief } from "../lib/integrations/mcpIntake";
import { trackerFromFile, trackerToFile, emptyTrackerFile, recordEpicLink } from "../lib/integrations/mcpTracker";
import {
  parseFieldFlags,
  collectSecrets,
  secretsByKeychainKey,
  buildCustomTransport,
  formatConnectionLine,
  parseConnectArgv,
} from "./mcp/connectCli";

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

// ── Planning personas + tools ─────────────────────────────────────────────────
// PM/Architect system prompts are imported from lib/planning/personas.ts (pure).
// The write_document / suggest_verification TOOL SCHEMAS live in
// lib/planning/planningChat.ts, which pulls the desktop's browser-only module
// graph (Anthropic SDK w/ dangerouslyAllowBrowser + zustand stores) — so, exactly
// as with CODE_REVIEW_LENSES above, they're inlined here (kept byte-for-byte in
// sync) to keep the Node CLI build clean.

const WRITE_DOCUMENT_TOOL = {
  name: "write_document" as const,
  description:
    "Write or update the current document. Call this whenever the document should change, passing the FULL current document as Markdown (not a diff).",
  input_schema: {
    type: "object" as const,
    properties: {
      markdown: { type: "string" as const, description: "The complete document in Markdown." },
    },
    required: ["markdown"],
  },
};

const SUGGEST_VERIFICATION_TOOL = {
  name: "suggest_verification" as const,
  description:
    "Propose the single shell command Cadre should run to verify each story is done (e.g. 'npm test', 'pnpm test', 'cargo test'). Call this once the testing strategy is clear so the user can just confirm it.",
  input_schema: {
    type: "object" as const,
    properties: {
      command: {
        type: "string" as const,
        description: "One shell command that exits 0 on success (the verification gate).",
      },
    },
    required: ["command"],
  },
};

// The SM (Scrum Master) persona — kept in sync with useCadre.ts's SM_SYSTEM_PROMPT.
const SM_SYSTEM_PROMPT = `You are the Scrum Master (SM). Turn the approved plan into the NEXT single implementation story via the create_story tool.

Prefer a small, vertically-sliced, independently testable story. Populate every field completely — the Dev agent works only from this story and reads nothing else, so put the relevant architecture, file paths, and standards into devNotes. Acceptance criteria must be concrete and testable; tasks must be TDD-first (write the failing test, then the code).

Declare the exact repo-relative \`files\` this story will create or modify, and keep stories FILE-DISJOINT from one another — Cadre runs file-disjoint stories as parallel agents, and any file two stories share forces them to run sequentially. Slice the work so parallel stories don't touch the same files.

Think across every LAYER (frontend/UI, backend/API, database) and the WHOLE lifecycle (setup, DevOps/CI-CD/deployment, tests, QA/acceptance testing, integration, monitoring, documentation, support) — not just backend features. A backlog that is backend-only, or missing the frontend, database, QA, or deployment work, is incomplete.

Every story MUST include an extensive Definition of Done — a thorough, checkable list (acceptance criteria met and test-covered, edge cases, no regressions, docs, and the frozen verification command green). A story without a real DoD is incomplete.`;

/** Where the planning artifacts live under the project root (mirrors useCadre.ts). */
const PRD_PATH = "docs/prd.md";
const ARCH_PATH = "docs/architecture.md";

function log(msg = ""): void {
  process.stdout.write(msg + "\n");
}

/** Write a project file (creating parent dirs), given a root-relative path. */
async function writeProjectFile(root: string, relPath: string, content: string): Promise<void> {
  const abs = join(root, relPath);
  await mkdir(dirname(abs), { recursive: true });
  await fsWriteFile(abs, content, "utf8");
}

/** The `{ markdown }` a write_document tool call returns, or null when empty. */
function docFromTool(input: unknown): string | null {
  const i = (input ?? {}) as { markdown?: unknown };
  return typeof i.markdown === "string" && i.markdown.trim() ? i.markdown : null;
}

/** The `{ command }` a suggest_verification tool call returns, or null when empty. */
function verifyCommandFromTool(input: unknown): string | null {
  const i = (input ?? {}) as { command?: unknown };
  return typeof i.command === "string" && i.command.trim() ? i.command.trim() : null;
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

/** Sync a story's status to the configured MCP tracker via a headless agent
 *  (`src/cli/mcp/trackerSyncNode.ts`, the Node twin of the desktop app's
 *  `mcpTrackerStore.syncStory`). No-op when no connection is designated as
 *  the tracker; never throws — sync is downstream of truth and must never
 *  fail the run, so it's safe to await inline in the dispatch flow. */
function syncTracker(root: string, card: StoryCard, status: Status, verifyCmd: string | undefined): Promise<void> {
  return syncStoryNode(
    realNodeIo(),
    root,
    { epic: card.epic, story: card.story, title: card.title ?? card.id },
    status,
    verifyCmd,
    { resolveTrackerEnv: resolveTrackerEnvNode, runSyncAgent: realRunSyncAgentNode() }
  );
}

/**
 * Run one Approved story through the full lifecycle — the headless mirror of
 * useCadre.dispatchStory: dispatch a real agent on a `story/<e>.<s>` worktree →
 * engine verifies → adversarial review gate → integrate → Done | Blocked.
 */
async function runOneStory(root: string, card: StoryCard, verifyCmd: string | undefined): Promise<RunOutcome> {
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

  // Sync the tracker at the engine's REAL transition points (InProgress →
  // InReview → Done|Failed) by wrapping the engine's setStatus dep — the CLI
  // twin of the desktop hooking bmadStore.setStatus. This guarantees we only
  // ever report a transition the story actually reached: if runApprovedStory
  // throws before the engine sets InProgress (e.g. the per-repo verify gate),
  // the wrapper is never invoked and nothing is synced (no stuck InProgress).
  const deps = nodeOrchestratorDeps(root, onOutput);
  deps.setStatus = syncingSetStatus(deps.setStatus, (_e, _s, status) =>
    syncTracker(root, card, status, verifyCmd)
  );

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
    // This Blocked write is cmdRun's OWN transition (imported nodeDeps
    // setStatus, NOT the wrapped engine dep), so sync it manually — exactly once.
    await setStatus(root, epic, story, "Blocked");
    await syncTracker(root, card, "Blocked", verifyCmd);
    return { id: card.id, title: card.title, status: "Blocked", note: "code review blocked — not integrated" };
  }

  // Merge the verified worktree back into main. On conflict → Blocked for the human.
  const integ = await integrateStory({ runGit }, { root, repoPath, epic, story });
  if (integ.conflict) {
    // Also cmdRun's own Blocked transition (imported setStatus) — sync manually.
    await setStatus(root, epic, story, "Blocked");
    await syncTracker(root, card, "Blocked", verifyCmd);
    log(`[cadre] merge conflict integrating ${card.id} — Blocked for manual integration`);
    return { id: card.id, title: card.title, status: "Blocked", note: "merge conflict — Blocked" };
  }
  log(`[cadre] integrated story ${card.id} into main`);
  // Done was already synced by the wrapped setStatus when the engine's
  // verifyStory wrote it (before this review+integrate gate) — no manual sync
  // here, or the transition would double-sync.
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

  // The frozen verification command(s) for this run, joined for the tracker
  // comment (mirrors bmadStore.ts's `verifyCmd` derivation for the GUI).
  const verifyCmd = approval.verification.filter(Boolean).join(" && ") || undefined;

  const outcomes: RunOutcome[] = [];
  for (const card of approved) {
    try {
      const outcome = await runOneStory(root, card, verifyCmd);
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

/** The shared "no planning key" message + non-zero exit. */
function planKeyMissing(): number {
  log(
    "[cadre] no Anthropic planning key found. Planning uses the Anthropic API (not the\n" +
      "        `claude` login). Set ANTHROPIC_API_KEY, or store the key in the macOS\n" +
      "        keychain (service `dev.cadre.ide`, account `anthropic_api_key`)."
  );
  return 1;
}

/**
 * `cadre plan "<brief>" [projectDir]` — the headless PM + Architect turns.
 * PM → docs/prd.md, Architect → docs/architecture.md + the verify command, then
 * freeze the plan approval so `cadre run` can proceed.
 */
async function cmdPlan(brief: string, projectDir: string): Promise<number> {
  const root = resolve(projectDir);
  if (!brief.trim()) {
    log('cadre plan: a brief is required — cadre plan "<brief>" [projectDir]');
    return 1;
  }
  const apiKey = await getPlanningKey();
  if (!apiKey) return planKeyMissing();
  const model = planningModel();

  log(`cadre plan — project: ${root}`);
  log(`[cadre] planning model: ${model}`);

  // PM turn → the PRD.
  log("[cadre] PM: running discovery + drafting the PRD…");
  const pmInput = await callTool({
    apiKey,
    model,
    systemPrompt: PM_SYSTEM_PROMPT,
    userPrompt: [
      "You are running HEADLESS — a single automated turn, with no back-and-forth with a human.",
      "Do your discovery internally, make reasonable and explicit assumptions where a human would",
      "normally be asked, then call the write_document tool with the FULL PRD in Markdown (the Spec",
      "kernel first, then the detail sections). Do NOT ask questions — produce the PRD now.",
      "",
      "## Brief",
      brief,
    ].join("\n"),
    tool: WRITE_DOCUMENT_TOOL,
  });
  const prd = docFromTool(pmInput);
  if (!prd) {
    log("[cadre] PM did not return a PRD document.");
    return 1;
  }
  await writeProjectFile(root, PRD_PATH, prd);
  log(`[cadre] wrote ${PRD_PATH} (${prd.length} chars)`);

  // Architect turn → the architecture document.
  log("[cadre] Architect: designing the architecture…");
  const archInput = await callTool({
    apiKey,
    model,
    systemPrompt: ARCHITECT_SYSTEM_PROMPT,
    userPrompt: [
      "You are running HEADLESS — a single automated turn. Given the brief and the PRD below,",
      "call the write_document tool with the FULL technical architecture in Markdown (## Tech Stack,",
      "## Components, ## Data Model, ## Integrations, ## Testing Strategy). Do NOT ask questions.",
      "",
      "## Brief",
      brief,
      "",
      "## PRD",
      prd,
    ].join("\n"),
    tool: WRITE_DOCUMENT_TOOL,
  });
  const architecture = docFromTool(archInput);
  if (!architecture) {
    log("[cadre] Architect did not return an architecture document.");
    return 1;
  }
  await writeProjectFile(root, ARCH_PATH, architecture);
  log(`[cadre] wrote ${ARCH_PATH} (${architecture.length} chars)`);

  // Architect turn → the frozen verification command.
  log("[cadre] Architect: proposing the verification command…");
  const verifyInput = await callTool({
    apiKey,
    model,
    systemPrompt: ARCHITECT_SYSTEM_PROMPT,
    userPrompt: [
      "Given the architecture below, call the suggest_verification tool with the SINGLE shell",
      "command Cadre should run to verify each story is done (e.g. 'npm test'). It must exit 0 on",
      "success. Return only the tool call.",
      "",
      "## Architecture",
      architecture,
    ].join("\n"),
    tool: SUGGEST_VERIFICATION_TOOL,
  });
  const command = verifyCommandFromTool(verifyInput);
  if (!command) {
    log("[cadre] Architect did not propose a verification command.");
    return 1;
  }

  await setPlanApproval(root, planApproval([command]));
  log("[cadre] froze plan approval → .cadre/approvals/plan.json");
  log(`\n[cadre] plan ready. Verification command: ${command}`);
  log("[cadre] next: cadre shard");
  return 0;
}

/**
 * `cadre shard [projectDir]` — the SM turn. Read the plan (prd + architecture)
 * for context, call the SM with the backlog tool, and write each story to
 * docs/stories/<epic>.<n>.<slug>.md (Draft).
 */
async function cmdShard(projectDir: string): Promise<number> {
  const root = resolve(projectDir);
  const apiKey = await getPlanningKey();
  if (!apiKey) return planKeyMissing();
  const model = planningModel();

  const prd = await readFile(join(root, PRD_PATH)).catch(() => "");
  const architecture = await readFile(join(root, ARCH_PATH)).catch(() => "");
  if (!prd.trim() || !architecture.trim()) {
    log(`[cadre] no plan found (${PRD_PATH} + ${ARCH_PATH}). Run \`cadre plan\` first.`);
    return 1;
  }
  const planContext = `# PRD\n\n${prd}\n\n---\n\n# Architecture\n\n${architecture}`;

  const epic = 1;
  const board = await readBoard(root);
  const start = nextStoryNumber(epic, board.map((c) => c.id));

  log(`cadre shard — project: ${root}`);
  log(`[cadre] planning model: ${model}`);
  log("[cadre] SM: generating the full lifecycle backlog…");

  const toolInput = await callTool({
    apiKey,
    model,
    systemPrompt: SM_SYSTEM_PROMPT,
    userPrompt:
      "Produce the COMPLETE backlog to build AND operate the plan below. Cover every LAYER — " +
      "frontend/UI, backend/API, database (schema + migrations) — and every PHASE — setup, DevOps " +
      "(CI/CD, infra, deployment), tests, QA (test plans, e2e/acceptance), integration, monitoring, " +
      "documentation, and support. Do NOT return a backend-only backlog. Fully specify every story.\n\n## Plan context\n" +
      planContext,
    tool: CREATE_BACKLOG_TOOL,
  });

  const stories = backlogFromTool(toolInput, epic, start);
  if (stories.length === 0) {
    log("[cadre] SM returned an empty backlog.");
    return 1;
  }
  for (const content of stories) {
    const { path } = await shardStory(
      { writeFile: (relPath, c) => writeProjectFile(root, relPath, c) },
      content
    );
    log(`[cadre] wrote ${path}`);
  }
  log(`\n[cadre] sharded ${stories.length} stories (Draft). Approve them: cadre approve --all`);
  return 0;
}

/**
 * `cadre approve [projectDir] [--all | <e.s> …]` — set stories Draft → Approved
 * (writes `.cadre/state/<e>.<s>.json` via the engine state store; only legal
 * transitions are written).
 */
async function cmdApprove(projectDir: string, all: boolean, ids: string[]): Promise<number> {
  const root = resolve(projectDir);
  const board = await readBoard(root);
  if (board.length === 0) {
    log(`No stories found under ${join(root, "docs", "stories")}.`);
    return 1;
  }

  let targets: StoryCard[];
  if (all) {
    targets = board.filter((c) => c.status === "Draft");
  } else {
    if (ids.length === 0) {
      log("cadre approve: pass --all, or one or more story ids (e.g. cadre approve 1.2 1.3)");
      return 1;
    }
    const wanted = new Set(ids);
    for (const id of ids) {
      if (!board.some((c) => c.id === id)) log(`[cadre] no story ${id} on the board — skipping`);
    }
    targets = board.filter((c) => wanted.has(c.id));
  }

  if (targets.length === 0) {
    log("[cadre] nothing to approve.");
    return 0;
  }

  let approved = 0;
  for (const c of targets) {
    if (c.status === "Approved") {
      log(`[cadre] ${c.id} already Approved`);
      continue;
    }
    if (!canApprove(c.status)) {
      log(`[cadre] cannot approve ${c.id} from ${c.status} — skipping`);
      continue;
    }
    await setStatus(root, c.epic, c.story, "Approved");
    approved++;
    log(`[cadre] approved ${c.id}`);
  }
  log(`\n[cadre] ${approved} stor${approved === 1 ? "y" : "ies"} → Approved.`);
  return 0;
}

/**
 * `cadre build "<brief>" [projectDir] [--auto]` — the one-shot payoff:
 * plan → shard → approve --all → run. Stops at the first stage that fails.
 */
async function cmdBuild(brief: string, projectDir: string, auto: boolean): Promise<number> {
  log("══ cadre build ══ plan → shard → approve → run\n");
  let code = await cmdPlan(brief, projectDir);
  if (code !== 0) return code;
  log("");
  code = await cmdShard(projectDir);
  if (code !== 0) return code;
  log("");
  code = await cmdApprove(projectDir, true, []);
  if (code !== 0) return code;
  log("");
  return cmdRun(projectDir, auto);
}

/** Path to the epic↔ticket / task-id link file (mirrors trackerSyncNode.ts's
 *  own local `mcpTrackerPath`; kept as a small local duplicate here rather
 *  than exporting cross-module coupling for one path constant). */
const mcpTrackerLinkPath = (root: string) => `${root}/.cadre/mcp-tracker.json`;

/**
 * `cadre intake <ticketId> [projectDir] [--build]` — fetch a tracker ticket
 * via the designated tracker MCP connection, turn it into a brief, and hand
 * it to `cmdPlan`. Unlike tracker SYNC (downstream of truth — swallows every
 * failure so a hiccup can never fail `cadre run`), intake is LOUD: no
 * tracker connection, or a fetch/parse failure, exits 1 immediately — there
 * is no plan yet to protect. Recording the epic↔ticket link, by contrast,
 * runs AFTER the plan succeeds and is best-effort: a tracker hiccup there
 * must never undo a plan that already landed.
 */
async function cmdIntake(ticketRef: string, projectDir: string, opts: { build: boolean }): Promise<number> {
  const root = resolve(projectDir);
  const io = realNodeIo();

  let ticket;
  try {
    ticket = await fetchTicketNode(io, root, ticketRef);
  } catch (e) {
    log(`cadre intake: ${(e as Error)?.message ?? String(e)}`);
    return 1;
  }

  log(`[cadre] imported ${ticket.id}: ${ticket.title}`);

  const planCode = await cmdPlan(ticketToBrief(ticket), projectDir);
  if (planCode !== 0) return planCode;

  // Best-effort epic↔ticket link — the plan already succeeded, so a tracker
  // hiccup here must never fail the intake.
  try {
    const env = await resolveTrackerEnvNode(io, root);
    if (env) {
      const path = mcpTrackerLinkPath(root);
      let file: ReturnType<typeof emptyTrackerFile> | null = null;
      try {
        const raw = await io.readFile(path);
        if (raw === null) {
          file = emptyTrackerFile(env.serverKey);
        } else {
          const parsed = trackerFromFile(raw);
          if (parsed === null) {
            log("[cadre] warning: .cadre/mcp-tracker.json is present but malformed — skipping epic link");
          } else {
            file = parsed;
          }
        }
      } catch (e) {
        log(`[cadre] warning: could not read .cadre/mcp-tracker.json — skipping epic link: ${String(e)}`);
      }
      if (file) {
        const linked = recordEpicLink(file, 1, { ticketId: ticket.id, url: ticket.url });
        await io.writeFile(path, trackerToFile(linked));
      }
    }
  } catch (e) {
    log(`[cadre] warning: could not record epic link: ${String(e)}`);
  }

  if (!opts.build) return 0;

  log("");
  let code = await cmdShard(projectDir);
  if (code !== 0) return code;
  log("");
  code = await cmdApprove(projectDir, true, []);
  if (code !== 0) return code;
  log("");
  return cmdRun(projectDir, true);
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

interface CmdConnectOpts {
  token?: string;
  fields: string[];
  asTracker: boolean;
  command?: string;
  args?: string;
  url?: string;
}

/**
 * `cadre connect <presetId> [projectDir] [--token <t>] [--field K=V …]
 * [--as-tracker] [--command <c>] [--args <a,b,c>] [--url <u>]` — seed a
 * connection from a CATALOG preset, probe it live, and on success persist it
 * (keychain + `.cadre/mcp.json` + materialize). Never saves on probe failure,
 * and never prints a secret value.
 */
async function cmdConnect(presetId: string, projectDir: string, opts: CmdConnectOpts): Promise<number> {
  const root = resolve(projectDir);
  const preset = CATALOG.find((p) => p.id === presetId);
  if (!preset) {
    log(`cadre connect: unknown preset "${presetId}". Valid presets: ${CATALOG.map((p) => p.id).join(", ")}`);
    return 1;
  }

  const io = realNodeIo();
  const existing = await readConnections(io, root);
  let conn = presetToConnection(preset, existing);

  if (preset.custom) {
    const built = buildCustomTransport({ command: opts.command, args: opts.args, url: opts.url });
    if ("error" in built) {
      log(`cadre connect: ${built.error}`);
      return 1;
    }
    conn = { ...conn, transport: built.transport };
  }

  const { secrets, missing } = collectSecrets(preset, {
    token: opts.token,
    fields: parseFieldFlags(opts.fields),
    envToken: process.env.CADRE_MCP_TOKEN,
  });
  if (missing.length > 0) {
    log(
      `cadre connect: missing required field(s): ${missing.join(", ")} ` +
        `(pass --token <value>, or --field ${missing[0]}=<value>)`
    );
    return 1;
  }

  const byKeychainKey = secretsByKeychainKey(conn, secrets);
  const probe = await probeConnection(conn, async (key) => byKeychainKey[key] ?? null);
  if (!probe.ok) {
    log(`cadre connect: probe failed — ${probe.error ?? "unknown error"}`);
    return 1;
  }
  log(`[cadre] Connected · ${probe.toolCount} tools`);

  conn = { ...conn, status: "connected", toolCount: probe.toolCount, enabled: true };
  await upsertConnection(io, root, conn, secrets);
  if (opts.asTracker) {
    await setRoleNode(io, root, conn.id, "tracker");
  }

  log(`[cadre] saved ${conn.id}${opts.asTracker ? " (tracker)" : ""}`);
  return 0;
}

/** `cadre connections [projectDir]` — list every connection in `.cadre/mcp.json`. */
async function cmdConnections(projectDir: string): Promise<number> {
  const root = resolve(projectDir);
  const io = realNodeIo();
  const list = await readConnections(io, root);
  if (list.length === 0) {
    log("No connections. Add one with: cadre connect <preset> [--token <t>]");
    return 0;
  }
  for (const conn of list) log(formatConnectionLine(conn));
  return 0;
}

/** `cadre disconnect <id> [projectDir]` — remove a connection (keychain + registry + re-materialize). */
async function cmdDisconnect(id: string, projectDir: string): Promise<number> {
  const root = resolve(projectDir);
  const io = realNodeIo();
  const list = await readConnections(io, root);
  if (!list.some((c) => c.id === id)) {
    log(`cadre disconnect: no connection "${id}"`);
    return 1;
  }
  await removeConnection(io, root, id);
  log(`[cadre] disconnected ${id}`);
  return 0;
}

function usage(): void {
  log("Usage:");
  log('  cadre plan "<brief>" [projectDir]            PM + Architect → PRD, architecture, plan approval');
  log("  cadre shard [projectDir]                     SM → the full lifecycle backlog (Draft)");
  log("  cadre approve [projectDir] [--all | <e.s>…]  set stories Draft → Approved");
  log('  cadre build "<brief>" [projectDir] [--auto]  one-shot: plan → shard → approve → run');
  log("  cadre intake <ticketId> [projectDir] [--build]");
  log("                                                fetch a tracker ticket → brief → plan (+ shard/approve/run)");
  log("  cadre run [projectDir] [--auto]              run every Approved story through the full lifecycle");
  log("  cadre status [projectDir]                    print the board (id · title · status)");
  log("  cadre connect <preset> [projectDir] [--token <t>] [--field K=V…] [--as-tracker]");
  log("                                                [--command <c>] [--args <a,b>] [--url <u>]");
  log("                                                connect + probe an MCP server, save on success");
  log("  cadre connections [projectDir]               list configured MCP connections");
  log("  cadre disconnect <id> [projectDir]           remove an MCP connection");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const rest = argv.slice(1);
  const auto = rest.includes("--auto");
  const all = rest.includes("--all");
  const positional = rest.filter((a) => !a.startsWith("-"));
  const cwd = process.cwd();

  let code = 0;
  if (cmd === "run") {
    code = await cmdRun(positional[0] ?? cwd, auto);
  } else if (cmd === "status") {
    code = await cmdStatus(positional[0] ?? cwd);
  } else if (cmd === "plan") {
    code = await cmdPlan(positional[0] ?? "", positional[1] ?? cwd);
  } else if (cmd === "shard") {
    code = await cmdShard(positional[0] ?? cwd);
  } else if (cmd === "approve") {
    // Positionals split unambiguously: a story id is `<e>.<s>`; anything else is the projectDir.
    const idArgs = positional.filter((a) => /^\d+\.\d+$/.test(a));
    const dirArgs = positional.filter((a) => !/^\d+\.\d+$/.test(a));
    code = await cmdApprove(dirArgs[0] ?? cwd, all, idArgs);
  } else if (cmd === "build") {
    code = await cmdBuild(positional[0] ?? "", positional[1] ?? cwd, auto);
  } else if (cmd === "intake") {
    const build = rest.includes("--build");
    const ticketRef = positional[0];
    if (!ticketRef) {
      log("cadre intake: a ticket id is required — cadre intake <ticketId> [projectDir] [--build]");
      code = 1;
    } else {
      code = await cmdIntake(ticketRef, positional[1] ?? cwd, { build });
    }
  } else if (cmd === "connect") {
    // --token/--field/--command/--args/--url all take a value, so they can't
    // use the generic `positional` filter above (their VALUES would leak in
    // as a bogus projectDir) — parseConnectArgv consumes them properly.
    const parsed = parseConnectArgv(rest);
    const presetId = parsed.positional[0];
    if (!presetId) {
      log("cadre connect: a preset id is required — cadre connect <presetId> [projectDir] [--token <t>]");
      code = 1;
    } else {
      code = await cmdConnect(presetId, parsed.positional[1] ?? cwd, {
        token: parsed.token,
        fields: parsed.fields,
        asTracker: parsed.asTracker,
        command: parsed.command,
        args: parsed.args,
        url: parsed.url,
      });
    }
  } else if (cmd === "connections") {
    code = await cmdConnections(positional[0] ?? cwd);
  } else if (cmd === "disconnect") {
    const id = positional[0];
    if (!id) {
      log("cadre disconnect: a connection id is required — cadre disconnect <id> [projectDir]");
      code = 1;
    } else {
      code = await cmdDisconnect(id, positional[1] ?? cwd);
    }
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
