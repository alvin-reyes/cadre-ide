/**
 * demoMode.ts — Demo mode flag and entry point.
 *
 * isDemoMode()    → read the current flag
 * setDemoMode(on) → set the flag
 * enterDemoMode() → install backend, seed project, navigate into Execute
 */

import { installMockBackend } from "./mockBackend";
import { MockFs } from "./mockFs";
import { DEMO_PRD, DEMO_ARCHITECTURE, DEMO_UX, DEMO_DOCS, DEMO_OPS, DEMO_BACKLOG } from "./demoContent";
import { composeStoryFile, slugify } from "../engine/shard";
import type { PlanApproval } from "../engine/planApproval";
import type { Status } from "../engine/status";

// Module-level flag (in-memory for this session)
let _demoMode = false;
// Tracks whether enterDemoMode already installed + seeded (idempotency guard).
// Distinct from isDemoMode(), which is already true when entered via ?demo=1.
let _entered = false;

/** Returns true when running in browser demo mode (not real Tauri). */
export function isDemoMode(): boolean {
  if (typeof window === "undefined") return false;
  // Check module flag, URL param, or localStorage marker
  if (_demoMode) return true;
  if (typeof URLSearchParams !== "undefined") {
    const params = new URLSearchParams(
      typeof window.location !== "undefined" ? window.location.search : ""
    );
    if (params.get("demo") === "1") return true;
  }
  if (typeof localStorage !== "undefined") {
    if (localStorage.getItem("cadre-demo") === "1") return true;
  }
  return false;
}

/** Explicitly set or clear demo mode. */
export function setDemoMode(on: boolean): void {
  _demoMode = on;
  if (typeof localStorage !== "undefined") {
    if (on) {
      localStorage.setItem("cadre-demo", "1");
    } else {
      localStorage.removeItem("cadre-demo");
    }
  }
}

// ─── Demo project path ────────────────────────────────────────────────────────

const DEMO_ROOT = "/demo/acme";

// ─── Seed builder ─────────────────────────────────────────────────────────────

/**
 * The demo stories with their pre-seeded statuses (a mix for variety).
 * Stories follow the DEMO_BACKLOG shape; we add epic/story numbering.
 */
const DEMO_STORY_STATUSES: Status[] = [
  "Done",        // 1.1 — project scaffold (setup epic, complete)
  "InReview",    // 1.2 — add task feature (in review)
  "InProgress",  // 1.3 — dashboard summary (in progress)
  "Approved",    // 1.4 — e2e test suite (approved, ready to dispatch)
  "Draft",       // 1.5 — ops / deploy runbook (draft)
];

/**
 * Build the initial seed files for the demo project.
 *
 * Paths are absolute (rooted at DEMO_ROOT = /demo/acme).
 */
function buildSeedFiles(): Record<string, string> {
  const files: Record<string, string> = {};

  // ── cadre.json ────────────────────────────────────────────────────────────
  files[`${DEMO_ROOT}/cadre.json`] = JSON.stringify(
    {
      cadre: "0.1",
      name: "Acme Task Manager",
      createdAt: "2026-07-01T00:00:00.000Z",
    },
    null,
    2
  );

  // ── CLAUDE.md ─────────────────────────────────────────────────────────────
  files[`${DEMO_ROOT}/CLAUDE.md`] = `# CLAUDE.md — working in Acme Task Manager

This file is the project **constitution** — the standing decisions and conventions
every agent follows. This is a **Cadre** demo project.

## Stack
React 19 + TypeScript, Zustand, Vitest, Vite.

## Standards
- Work test-first: write the failing test first, then the code.
- Do NOT edit \`.cadre/\` state — the engine decides Done.
- Verification command: \`npm test\`
`;

  // ── Planning docs ─────────────────────────────────────────────────────────
  files[`${DEMO_ROOT}/docs/prd.md`] = DEMO_PRD;
  files[`${DEMO_ROOT}/docs/architecture.md`] = DEMO_ARCHITECTURE;
  files[`${DEMO_ROOT}/docs/ux-spec.md`] = DEMO_UX;
  files[`${DEMO_ROOT}/docs/documentation.md`] = DEMO_DOCS;
  files[`${DEMO_ROOT}/docs/ops.md`] = DEMO_OPS;

  // ── Story files ───────────────────────────────────────────────────────────
  // Map DEMO_BACKLOG items to full StoryContent objects and compose the markdown.
  // We extend the backlog with two extra stories so the Kanban shows nice variety.
  const extendedBacklog = [
    ...DEMO_BACKLOG,
    {
      phase: "testing",
      title: "E2E test suite",
      role: "QA engineer",
      action: "run end-to-end tests covering the full task flow",
      benefit: "so that regressions are caught before deploy",
      acceptanceCriteria: ["E2E suite passes with all flows covered"],
      tasks: [
        "Write E2E tests for add / complete / delete flow",
        "Configure Playwright in CI",
        "Make all tests green",
      ],
      devNotes: "Use Playwright. Tests live at e2e/. Run with: npx playwright test.",
      files: ["e2e/app.spec.ts", "playwright.config.ts"],
      definitionOfDone: [
        "All E2E scenarios pass",
        "CI runs playwright on push",
        "npm test exits 0",
      ],
    },
    {
      phase: "ops",
      title: "Ops and deploy runbook",
      role: "DevOps engineer",
      action: "document the deploy process and set up CI/CD",
      benefit: "so that the team can ship reliably",
      acceptanceCriteria: ["CI pipeline green", "Deploy runbook in docs/ops.md"],
      tasks: [
        "Write GitHub Actions workflow",
        "Document deploy steps in docs/ops.md",
        "Verify CI passes",
      ],
      devNotes: "Use GitHub Actions. Static deploy to Vercel.",
      files: [".github/workflows/ci.yml", "docs/ops.md"],
      definitionOfDone: [
        "CI runs on push and passes",
        "Deploy documented",
        "npm test exits 0",
      ],
    },
  ];

  extendedBacklog.forEach((item, i) => {
    const epicNum = 1;
    const storyNum = i + 1;
    const slug = slugify(item.title);
    const storyContent = composeStoryFile({
      epic: epicNum,
      story: storyNum,
      title: item.title,
      userStory: {
        role: item.role,
        action: item.action,
        benefit: item.benefit,
      },
      acceptanceCriteria: item.acceptanceCriteria,
      tasks: item.tasks,
      devNotes: item.devNotes,
      files: item.files,
      definitionOfDone: item.definitionOfDone,
    });
    files[`${DEMO_ROOT}/docs/stories/${epicNum}.${storyNum}.${slug}.md`] = storyContent;
  });

  // ── State files (pre-seeded statuses) ─────────────────────────────────────
  DEMO_STORY_STATUSES.forEach((status, i) => {
    const epicNum = 1;
    const storyNum = i + 1;
    // Match the engine's on-disk state shape ({epic,story,status}) so board.ts
    // `reconcile` maps the status onto the story (else it stays Draft).
    files[`${DEMO_ROOT}/.cadre/state/${epicNum}.${storyNum}.json`] = JSON.stringify(
      { epic: epicNum, story: storyNum, status },
      null,
      2
    );
  });

  // ── Plan approval ─────────────────────────────────────────────────────────
  const approval: PlanApproval = {
    approved: true,
    verification: ["npm test"],
  };
  files[`${DEMO_ROOT}/.cadre/plan-approval.json`] = JSON.stringify(approval, null, 2);

  return files;
}

// ─── enterDemoMode ────────────────────────────────────────────────────────────

/**
 * Enter demo mode: install the mock Tauri backend, seed the demo project,
 * and navigate the app into the seeded project (Execute board unlocked).
 *
 * Guard: if a real __TAURI_INTERNALS__ is already present (real Tauri build),
 * installMockBackend is a no-op — this is safe to call in any environment but
 * will only install the mock in a browser without Tauri.
 *
 * Callers should await this before rendering the app (or before navigating away
 * from SignIn) so the stores are populated before the first render.
 */
export async function enterDemoMode(): Promise<void> {
  // Idempotent: if we've ALREADY installed + seeded, don't rebuild the seed and
  // wipe state the user may have advanced (e.g. ?demo=1 + SignIn button, or a
  // double-click). NB: guard on `_entered`, NOT isDemoMode() — the latter is
  // already true when entered via ?demo=1, which would make this a no-op forever.
  if (_entered) return;
  _entered = true;

  setDemoMode(true);

  // Build the seed and install the mock backend (no-op under real Tauri).
  const seedFiles = buildSeedFiles();
  const mockFs = new MockFs(seedFiles);
  installMockBackend(mockFs);

  // Drive the app into the seeded project.
  // We do a dynamic import to avoid circular deps at module load time
  // (the stores import from @tauri-apps/api which the mock intercepts).
  const { useBmadStore } = await import("../../stores/bmadStore");
  const { useCadre } = await import("../../cadre/useCadre");
  const { useSettingsStore } = await import("../../stores/settingsStore");

  // Enable Claude login-mode so resolveFleetAuth succeeds without a key — the mock
  // agent ignores env, but dispatch bails if no credential path is configured.
  // Use setState (in-memory only) rather than setDispatchUseLogin so persistSettings
  // is NOT called and dispatchUseLogin:true is NOT written to localStorage["cadre-settings"],
  // which would silently leak login-mode into a later real (non-demo) browser session.
  useSettingsStore.setState({ dispatchUseLogin: true });

  // openProject sets the active root, seeds the BmadSlice, and hydrates the board
  // (reads story files + state files from the mock FS via invoke).
  await useBmadStore.getState().openProject(DEMO_ROOT);

  // hydrateFromProject reads docs/prd.md, docs/architecture.md, .cadre/plan-approval.json
  // etc. from the mock FS and lands the phase on EXECUTE (because plan is approved).
  await useCadre.getState().hydrateFromProject();

  // Ensure phase is EXECUTE (hydrate should set it; this is a safety net).
  const phase = useCadre.getState().phase;
  if (phase !== "EXECUTE") {
    useCadre.getState().setPhase("EXECUTE");
  }
}
