/**
 * The "always files" every dispatched agent receives alongside its story: the
 * session journal, the Context Store, the ADR decision log, and (for existing
 * codebases) the brownfield analysis.
 *
 * This lives in the engine behind a deps interface because it previously existed
 * TWICE — once in `useCadre` over Tauri `invoke`, once in `cli/cadre.ts` over
 * node `fs` — and the copies drifted. The CLI's loader filtered on
 * `name.endsWith(".md")`, which silently skipped the `decisions/` DIRECTORY, so
 * CLI agents never received the ADRs the Dev persona tells them to obey, nor the
 * session journal. One loader, both faces, so that class of drift cannot recur.
 *
 * Everything inlined here rides in the `claude -p "<prompt>"` argv, so the two
 * unbounded sources (the append-only decision log, and a multi-repo brownfield
 * analysis) are budgeted. When content is dropped we say so in the prompt rather
 * than truncating silently — an agent that doesn't know a decision exists will
 * re-decide it.
 */
import type { AlwaysFile } from "./dispatch";
import { ADR_DECISIONS_DIR } from "./adr";
import { SESSION_LOG_PATH } from "./sessionLog";
import { BROWNFIELD_DOC_PATH } from "./brownfield";

export const CONTEXT_STORE_DIR = ".cadre/context";
export const ADR_INJECT_BUDGET_BYTES = 24_000;
export const BROWNFIELD_INJECT_BUDGET_BYTES = 16_000;

export interface SharedContextEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface SharedContextDeps {
  /** Read a file's text. Rejects when absent — callers treat that as "no such file". */
  readFile: (path: string) => Promise<string>;
  /** List one directory. Rejects when absent. */
  listDir: (path: string) => Promise<SharedContextEntry[]>;
}

/** Read a file, treating any failure (absent/unreadable) as empty. */
async function readOrEmpty(deps: SharedContextDeps, path: string): Promise<string> {
  return deps.readFile(path).catch(() => "");
}

/** List a directory, treating any failure (absent) as empty. */
async function listOrEmpty(deps: SharedContextDeps, path: string): Promise<SharedContextEntry[]> {
  return deps.listDir(path).catch(() => [] as SharedContextEntry[]);
}

/**
 * Compose the shared context files for `root`. Order matters: journal first (what
 * the fleet has done), then shared contracts, then decisions, then the as-is map.
 */
export async function loadSharedContext(
  root: string,
  deps: SharedContextDeps
): Promise<AlwaysFile[]> {
  const files: AlwaysFile[] = [];

  // The session journal — what's already been planned/built/shipped — so a fresh
  // agent knows what's happening across the fleet, not just its own story.
  const journal = await readOrEmpty(deps, `${root}/${SESSION_LOG_PATH}`);
  if (journal.trim()) files.push({ path: SESSION_LOG_PATH, content: journal });

  // The Context Store: small, incremental shared contracts. The relevant
  // architecture already lives in each story's dev notes, so the whole
  // architecture.md is deliberately NOT inlined — doing so bloated the argv and
  // could fail the spawn outright.
  for (const e of await listOrEmpty(deps, `${root}/${CONTEXT_STORE_DIR}`)) {
    if (e.isDir || !e.name.endsWith(".md")) continue;
    const c = await readOrEmpty(deps, e.path);
    if (c.trim()) files.push({ path: `${CONTEXT_STORE_DIR}/${e.name}`, content: c });
  }

  // ADRs — durable decision records — so every agent consults prior decisions
  // before re-deciding. The log is append-only and grows for the life of a
  // project, so bound it: newest first, up to a byte budget.
  const adrEntries = (await listOrEmpty(deps, `${root}/${ADR_DECISIONS_DIR}`))
    .filter((e) => !e.isDir && e.name.endsWith(".md"))
    .sort((a, b) => b.name.localeCompare(a.name)); // zero-padded NNNN- prefix → newest first

  let used = 0;
  let injected = 0;
  for (const e of adrEntries) {
    const c = await readOrEmpty(deps, e.path);
    if (!c.trim()) continue;
    // Always inject at least the newest ADR; stop once the budget is exceeded.
    if (used + c.length > ADR_INJECT_BUDGET_BYTES && injected > 0) break;
    files.push({ path: `${ADR_DECISIONS_DIR}/${e.name}`, content: c });
    used += c.length;
    injected += 1;
  }
  const omitted = adrEntries.length - injected;
  if (omitted > 0) {
    files.push({
      path: `${ADR_DECISIONS_DIR}/_index.md`,
      content:
        `# Decision log (truncated)\n\nThe ${injected} most-recent ADR(s) are inlined above; ` +
        `${omitted} older ADR(s) were omitted to bound prompt size. Read \`${ADR_DECISIONS_DIR}/\` ` +
        `directly for the full history before diverging from a settled decision.`,
    });
  }

  // Brownfield: the as-is analysis, so an agent working existing code sees the
  // high-level map, not just its story. Bounded — a multi-repo aggregate is large
  // and rides every agent's argv.
  const brownfield = await readOrEmpty(deps, `${root}/${BROWNFIELD_DOC_PATH}`);
  if (brownfield.trim()) {
    const capped =
      brownfield.length > BROWNFIELD_INJECT_BUDGET_BYTES
        ? brownfield.slice(0, BROWNFIELD_INJECT_BUDGET_BYTES) +
          `\n\n…(analysis truncated for prompt size — read \`${BROWNFIELD_DOC_PATH}\` in full for the complete picture)`
        : brownfield;
    files.push({ path: BROWNFIELD_DOC_PATH, content: capped });
  }

  return files;
}
