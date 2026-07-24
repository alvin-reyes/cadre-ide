/**
 * demoContent.ts — Canned demo data for the demo mode build agent AND
 * the mock Anthropic planning layer (Task 3).
 *
 * Provides:
 *  - DEMO_PRD / DEMO_ARCHITECTURE / DEMO_UX / DEMO_DOCS / DEMO_OPS — planning
 *    artifacts returned by the mock Anthropic client via write_document tool.
 *  - DEMO_BACKLOG / DEMO_STORY — canned create_backlog / create_story payloads.
 *  - buildTranscript / streamTranscript — PTY transcript helpers for Task 2.
 */

// ─── Planning artifacts (Task 3) ─────────────────────────────────────────────

/**
 * Canned PRD returned by the PM persona's write_document tool.
 * Short but structurally complete — the demo only needs the flow to work.
 */
export const DEMO_PRD = `# Product Requirements Document — Demo App

## Spec
**Why:** Users need a faster way to manage daily tasks without context-switching.
**Capabilities:** Create, complete, and delete tasks; view a simple dashboard.
**Constraints:** Web-only MVP; no auth required for the demo.
**Non-goals:** Mobile app, collaboration, integrations.
**Success signal:** A user can create 5 tasks and mark 3 done in under 60 seconds.

## Goals
Ship a minimal, polished task manager that showcases Cadre's end-to-end flow.

## Target Users
Individual developers evaluating Cadre's demo mode.

## Requirements
- Add a task with a title.
- Mark a task as complete (strikethrough + move to Done).
- Delete a task.
- Dashboard: total / active / done counts.

## Epics
1. Core task CRUD
2. Dashboard + summary view

## Out of Scope
Authentication, teams, mobile, external integrations.
`;

/**
 * Canned architecture doc returned by the Architect persona.
 * Includes a frozen verification command (`npm test`).
 */
export const DEMO_ARCHITECTURE = `# Architecture — Demo App

## Tech Stack
- Frontend: React 19 + TypeScript
- State: Zustand
- Tests: Vitest + Testing Library
- Build: Vite

## Components
\`\`\`mermaid
flowchart TD
  App --> TaskList
  App --> Dashboard
  TaskList --> TaskItem
  TaskList --> AddTask
\`\`\`

## Data Model
\`\`\`mermaid
erDiagram
  TASK {
    string id PK
    string title
    boolean done
    datetime createdAt
  }
\`\`\`

## Testing Strategy
All logic covered by Vitest unit tests. Run with:

\`\`\`
npm test
\`\`\`

The frozen verification command is: **npm test**
`;

/**
 * Canned UX spec + mockup returned by the Designer persona.
 */
export const DEMO_UX = `# UX Spec — Demo App

## User Flows
\`\`\`mermaid
flowchart LR
  Start --> AddTask --> ViewList --> MarkDone --> ViewDone
\`\`\`

## Information Architecture
- Header: app name + dashboard counts
- Main: task list (active, then done)
- Footer: input + Add button

## Component Inventory
- \`<AddTask>\` — text input + button
- \`<TaskItem>\` — checkbox, title, delete icon
- \`<Dashboard>\` — total / active / done pill badges

## Screen States
- Empty: "No tasks yet. Add one above."
- Loading: spinner (for async saves)
- Error: toast message

## Visual & Interaction Guidelines
Clean, minimal; dark mode supported; hover states on interactive elements.
`;

/**
 * Canned documentation returned by the Technical Writer persona.
 */
export const DEMO_DOCS = `# Documentation — Demo App

## README
Quick-start guide for developers evaluating the demo.

### Setup
\`\`\`bash
npm install
npm run dev
\`\`\`

### Testing
\`\`\`bash
npm test
\`\`\`

## API Reference
No external API — all state is in-memory Zustand store.

## Architecture Overview
See \`docs/architecture.md\` for the full technical design.

## Runbooks
No production infra in the demo — all mock.
`;

/**
 * Canned ops plan returned by the DevOps/Release Engineer persona.
 */
export const DEMO_OPS = `# Ops Plan — Demo App

## CI/CD Pipeline
\`\`\`mermaid
flowchart LR
  Push --> Lint --> Test --> Build --> Deploy
\`\`\`

## Environments
- Local dev: \`npm run dev\`
- Demo: static hosting (Vercel / Netlify)

## Build & Release Process
1. Tag commit: \`v0.x.y\`
2. CI runs \`npm test && npm run build\`
3. Artefact deployed to demo URL

## Deployment Strategy
Static deploy — no downtime, instant rollback via CDN.

## Rollback
Revert to previous deployment in CDN dashboard.

## Secrets & Config
None required for the demo.

## Observability
Browser console + error toasts. No external APM for the demo.

## Runbooks
**Deploy failed:** re-run CI job. **Site down:** roll back in CDN dashboard.
`;

// ─── Backlog / story (Task 3) ─────────────────────────────────────────────────

/** A single canned story — valid against CREATE_STORY_TOOL schema (incl. definitionOfDone). */
export const DEMO_STORY = {
  title: "Add task feature",
  role: "developer",
  action: "add a new task with a title",
  benefit: "so that I can track my work items",
  acceptanceCriteria: [
    "User can type a title and press Add",
    "Task appears in the list immediately",
    "Empty title is rejected with an inline error",
  ],
  tasks: [
    "Write failing test for AddTask component",
    "Implement AddTask component with input + button",
    "Wire to Zustand store",
    "Make tests green",
  ],
  devNotes: "Use the existing taskStore (Zustand). Title must be non-empty. Component lives at src/components/AddTask.tsx.",
  files: ["src/components/AddTask.tsx", "src/stores/taskStore.ts"],
  definitionOfDone: [
    "AddTask renders with an input and a button",
    "Submitting a non-empty title adds the task to the store",
    "Submitting an empty title shows an inline error, does not add",
    "All new and existing tests pass (`npm test` exits 0)",
    "No regressions in the task list or dashboard",
  ],
};

/** A canned backlog (3 stories) valid against CREATE_BACKLOG_TOOL schema. */
export const DEMO_BACKLOG = [
  {
    phase: "setup",
    title: "Project scaffold",
    role: "developer",
    action: "scaffold the project with Vite + React + Vitest",
    benefit: "so that the team has a working baseline",
    acceptanceCriteria: ["npm run dev starts the dev server", "npm test runs and exits 0"],
    tasks: ["Run Vite scaffold", "Add Vitest", "Add Testing Library"],
    devNotes: "Use the official Vite React-TS template. Add vitest.config.ts.",
    files: ["vite.config.ts", "vitest.config.ts", "package.json"],
    definitionOfDone: [
      "Dev server starts on npm run dev",
      "npm test exits 0",
      "No lint errors",
    ],
  },
  {
    phase: "frontend",
    ...DEMO_STORY,
  },
  {
    phase: "frontend",
    title: "Dashboard summary",
    role: "developer",
    action: "see total / active / done task counts",
    benefit: "so that I know my progress at a glance",
    acceptanceCriteria: [
      "Dashboard shows correct counts after add/complete/delete",
    ],
    tasks: [
      "Write failing test for Dashboard counts",
      "Implement Dashboard component",
      "Make tests green",
    ],
    devNotes: "Read counts from taskStore selectors. Component at src/components/Dashboard.tsx.",
    files: ["src/components/Dashboard.tsx"],
    definitionOfDone: [
      "Dashboard shows total, active, and done counts",
      "Counts update immediately on task changes",
      "npm test exits 0",
      "No regressions",
    ],
  },
];

// ─── Types ────────────────────────────────────────────────────────────────────

export type PtyEvent =
  | { type: "output"; data: number[] }
  | { type: "exit"; code: number | null }
  | { type: "error"; message: string };

// ─── Transcript ───────────────────────────────────────────────────────────────

/**
 * Returns 6–12 short, realistic lines a build agent would print while
 * implementing a story. Optionally interpolates the story label.
 */
export function buildTranscript(label?: string): string[] {
  const story = label ? `"${label}"` : "the story";
  return [
    `Reading ${story}…`,
    "Checking out a fresh worktree…",
    "Writing failing test…",
    "Running tests — 1 failing, 0 passing",
    "Implementing the feature…",
    "Running tests — all passing",
    "Running linter — no issues",
    "Committing changes…",
    "Pushing branch…",
    "Done. Story complete.",
  ];
}

// ─── streamTranscript ────────────────────────────────────────────────────────

/**
 * Schedule PTY events for a transcript of lines.
 *
 * Each line is emitted as `{ type: "output", data: number[] }` (UTF-8 bytes)
 * spaced ~tick ms apart, then a final `{ type: "exit", code: 0 }` is emitted.
 *
 * Returns a `stop()` function that cancels pending events and (if called before
 * the stream finishes) emits `{ type: "exit", code: 143 }` instead.
 *
 * The `schedule` option (default: `setTimeout`) can be injected for
 * deterministic unit tests that use a fake/immediate timer.
 */
export function streamTranscript(
  emit: (e: PtyEvent) => void,
  lines: string[],
  opts?: {
    tick?: number;
    schedule?: (fn: () => void, ms: number) => unknown;
  }
): { stop: () => void } {
  const tick = opts?.tick ?? 300;
  const schedule = opts?.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));

  const handles: unknown[] = [];
  let stopped = false;

  // Schedule each line at an increasing offset.
  lines.forEach((line, i) => {
    const h = schedule(() => {
      if (stopped) return;
      const bytes = Array.from(new TextEncoder().encode(line + "\r\n"));
      emit({ type: "output", data: bytes });
    }, tick * (i + 1));
    handles.push(h);
  });

  // Schedule the exit event after all lines.
  const exitHandle = schedule(() => {
    if (stopped) return;
    stopped = true;
    emit({ type: "exit", code: 0 });
  }, tick * (lines.length + 1));
  handles.push(exitHandle);

  function stop(): void {
    if (stopped) return;
    stopped = true;
    for (const h of handles) {
      clearTimeout(h as ReturnType<typeof setTimeout>);
    }
    emit({ type: "exit", code: 143 });
  }

  return { stop };
}
