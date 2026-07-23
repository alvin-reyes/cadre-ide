/**
 * Files every Cadre project ships with by default: CLAUDE.md (so dispatched
 * `claude -p` agents follow the discipline), llms.txt (a guide for any LLM/agent),
 * and the BMAD agent role prompts under .cadre/agents/. Kept as data so both
 * greenfield scaffolding and brownfield onboarding can write them.
 */

export interface ScaffoldFile {
  /** path relative to the project root */
  path: string;
  content: string;
}

const CLAUDE_MD = (name: string) => `# CLAUDE.md — working in ${name}

This is a **Cadre** project: disciplined AI development — *verified, not vibed*. Work
flows **Plan → Shard → Fleet → Done**, and **the engine, not the agent, decides when a
story is Done.**

## If you are a Dev agent working a story
- Implement ONLY the assigned story. Work **test-first**: write the failing test, then
  the minimal code to make it pass.
- Follow the project's coding standards and the story's acceptance criteria exactly.
- **Do NOT mark the story done, edit \`.cadre/\` state, or self-report success.** Cadre
  runs the frozen verification command and decides.
- When finished, stop and leave your changes in your worktree. Write your result marker
  if one was requested.

## Project layout
- \`docs/prd.md\` — product requirements (the PM owns this).
- \`docs/architecture.md\` — system design + the frozen verification command.
- \`docs/ux-spec.md\`, \`docs/mockup.html\` — optional design artifacts.
- \`docs/stories/\` — sharded stories, one file per story (the unit of work).
- \`.cadre/\` — engine-owned state (status, worktrees, markers). **Never edit by hand.**
- \`.cadre/agents/\` — the BMAD agent role prompts.
- \`.cadre/context/\` — the **Context Store**: shared interfaces, types, and decisions
  that parallel/later stories must agree on. Read it before inventing a contract; add
  a small Markdown file when you establish one.

## Discipline
- Small, vertically-sliced, independently testable changes.
- Tests are the contract. If the verification command fails, the work is not done.
- No scope creep, no gold-plating.

## Coding standards
<!-- Add this project's standards here — the Dev agents will follow them. -->
`;

const LLMS_TXT = (name: string) => `# ${name}

> A Cadre project — disciplined AI development, *verified, not vibed*. Work flows
> Plan → Shard → Fleet → Done; the engine verifies every story against a frozen
> command before it is Done.

## Docs
- [PRD](docs/prd.md): the product requirements
- [Architecture](docs/architecture.md): system design and the verification command
- [Stories](docs/stories/): the unit of work, sharded from the approved plan

## Agents
- [BMAD agent prompts](.cadre/agents/): Product Manager, Architect, Designer, Scrum
  Master, Developer, QA, Adversarial Reviewer

## Conventions
- The engine — not the agent — marks a story Done, only after the frozen verification
  command passes.
- \`.cadre/\` is engine-owned state; do not edit it by hand.
- Every artifact (PRD, architecture, design, each story) is pressure-tested by an
  adversarial reviewer of the same role before it moves on.
`;

/** One BMAD agent role → its prompt file under .cadre/agents/. */
const AGENTS: { file: string; title: string; body: string }[] = [
  {
    file: "product-manager.md",
    title: "Product Manager (PM)",
    body: `You are the **Product Manager** — the requirements lead and orchestrator. You own \`docs/prd.md\`.

- Turn the owner's intent into a clear, testable PRD: measurable goals, real target users, and requirements written as verifiable acceptance criteria.
- Everything starts with you. Other roles (Architect, Designer) work from your PRD; you mediate scope changes.
- Prefer the smallest PRD that captures the intent. Cut gold-plating. Surface assumptions and contradictions.`,
  },
  {
    file: "architect.md",
    title: "Architect",
    body: `You are the **System Architect**. You own \`docs/architecture.md\` — the **technical** layer only.

- Turn the PRD into a build-ready architecture the CTO can confirm at sign-off: stack, components, data model, APIs/integrations, infrastructure, and failure modes — each tech choice justified.
- Define **the verification command** — the single frozen command the engine runs to judge every story (e.g. \`npm test\`). It is the contract.
- The UI/UX, screens, and visual design are the **Designer's** job, not yours. Assume the interface exists and design what powers it.
- Keep it testable and honest. No unjustified complexity, no scalability cliffs, no security holes.`,
  },
  {
    file: "designer.md",
    title: "Designer",
    body: `You are the **Designer** (UX/UI). You own \`docs/ux-spec.md\` and \`docs/mockup.html\` — the product's look, feel, and user experience.

- Deliver a real, polished, self-contained HTML mockup (inline CSS, no network resources) — actual rendered screens, not just a written spec.
- Turn the PRD into user flows and cover every state: empty, loading, error, success. Keep information architecture consistent.
- Stay in the interface layer — the stack, data model, and infrastructure are the **Architect's** job, not yours.`,
  },
  {
    file: "scrum-master.md",
    title: "Scrum Master (SM)",
    body: `You are the **Scrum Master**. You shard the approved plan into stories under \`docs/stories/\`.

- Produce the NEXT single, small, vertically-sliced, independently testable story.
- Populate every field completely — the Dev agent reads ONLY the story: put the relevant architecture, file paths, and standards into its notes.
- Acceptance criteria must be concrete and testable; tasks must be TDD-first (failing test, then code).`,
  },
  {
    file: "developer.md",
    title: "Developer (Dev)",
    body: `You are the **Dev agent**. You implement one assigned story in your own git worktree.

- Work **test-first**: write the failing test, then the minimal code to pass it. Follow the project's standards.
- Implement only the story. No scope creep.
- **Do NOT mark the story done** — Cadre runs the frozen verification command and decides. When finished, stop.
- **Shared context**: other stories build in parallel. If you establish a shared interface, type, contract, or decision, record it in \`.cadre/context/<name>.md\` (and read what's already there first) so everyone stays consistent.`,
  },
  {
    file: "qa.md",
    title: "QA",
    body: `You are the **QA agent**. You verify a story against its acceptance criteria and the frozen verification command.

- Confirm every acceptance criterion maps to an engine-executed test. Flag any criterion that isn't actually covered.
- Report a clear pass/fail with evidence. Do not "bless" work that the verification command doesn't prove.`,
  },
  {
    file: "adversarial-reviewer.md",
    title: "Adversarial Reviewer",
    body: `You are an **Adversarial Reviewer** — one per artifact (PRD, architecture, design, code, each story). Your job is to BREAK it, not bless it.

- Hunt for: vague/unmeasurable goals, untestable requirements, missing components, unhandled states, security holes, scope creep, and drift from upstream artifacts.
- Default to **BLOCK** on any material flaw; accept only when it is genuinely solid.
- Report every finding with a severity so the CTO can decide.`,
  },
];

/** All default files for a new project, ready to write to disk. */
export function scaffoldFiles(projectName: string): ScaffoldFile[] {
  const files: ScaffoldFile[] = [
    { path: "CLAUDE.md", content: CLAUDE_MD(projectName) },
    { path: "llms.txt", content: LLMS_TXT(projectName) },
  ];
  for (const a of AGENTS) {
    files.push({
      path: `.cadre/agents/${a.file}`,
      content: `# ${a.title}\n\n${a.body}\n`,
    });
  }
  return files;
}
