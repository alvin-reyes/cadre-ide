import { describe, it, expect } from "vitest";
import { scaffoldFiles, missingScaffoldFiles } from "./projectScaffold";

describe("scaffoldFiles", () => {
  it("ships CLAUDE.md, llms.txt, the BMAD rules, and the BMAD agent prompts", () => {
    const files = scaffoldFiles("acme");
    const paths = files.map((f) => f.path);

    expect(paths).toContain("CLAUDE.md");
    expect(paths).toContain("llms.txt");
    expect(paths).toContain(".cadre/rules.md");
    // One prompt per BMAD role, under .cadre/agents/.
    const agents = paths.filter((p) => p.startsWith(".cadre/agents/"));
    expect(agents).toEqual(
      expect.arrayContaining([
        ".cadre/agents/product-manager.md",
        ".cadre/agents/architect.md",
        ".cadre/agents/designer.md",
        ".cadre/agents/scrum-master.md",
        ".cadre/agents/developer.md",
        ".cadre/agents/qa.md",
        ".cadre/agents/devops.md",
        ".cadre/agents/adversarial-reviewer.md",
      ])
    );
  });

  it("interpolates the project name into CLAUDE.md and llms.txt", () => {
    const files = scaffoldFiles("acme");
    const claude = files.find((f) => f.path === "CLAUDE.md")!;
    const llms = files.find((f) => f.path === "llms.txt")!;
    expect(claude.content).toContain("acme");
    expect(llms.content.startsWith("# acme")).toBe(true);
  });

  it("tells Dev agents not to self-report Done", () => {
    const claude = scaffoldFiles("x").find((f) => f.path === "CLAUDE.md")!;
    expect(claude.content).toMatch(/do not mark the story done/i);
  });

  it("ships BMAD rules that enshrine engine-owned Done", () => {
    const rules = scaffoldFiles("x").find((f) => f.path === ".cadre/rules.md")!;
    expect(rules.content).toMatch(/Plan → Shard → Fleet → Done/);
    expect(rules.content).toMatch(/the engine owns/i);
    expect(rules.content).toMatch(/no agent marks a story Done/i);
  });

  it("gives every agent an elaborate, multi-section prompt", () => {
    const agents = scaffoldFiles("x").filter((f) => f.path.startsWith(".cadre/agents/"));
    for (const a of agents) {
      // Elaborate = substantial and structured (multiple markdown sections).
      expect(a.content.length).toBeGreaterThan(600);
      const sectionCount = (a.content.match(/^## /gm) || []).length;
      expect(sectionCount).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("missingScaffoldFiles", () => {
  const files = scaffoldFiles("acme");
  const allPaths = new Set(files.map((f) => f.path));

  it("returns nothing when every scaffold file already exists", () => {
    expect(missingScaffoldFiles(files, allPaths)).toEqual([]);
  });

  it("returns everything for a project with no scaffold at all", () => {
    expect(missingScaffoldFiles(files, new Set())).toHaveLength(files.length);
  });

  it("returns only the files that are absent", () => {
    const existing = new Set(allPaths);
    existing.delete("CLAUDE.md");
    existing.delete(".cadre/agents/qa.md");
    const missing = missingScaffoldFiles(files, existing);
    expect(missing.map((f) => f.path).sort()).toEqual([".cadre/agents/qa.md", "CLAUDE.md"]);
  });

  it("never returns a file that exists, whatever its content — the no-clobber guarantee", () => {
    // The caller only knows PATHS, not contents. A user who has heavily edited
    // their CLAUDE.md must never see it reappear in the write list.
    const missing = missingScaffoldFiles(files, new Set(["CLAUDE.md"]));
    expect(missing.map((f) => f.path)).not.toContain("CLAUDE.md");
  });

  it("matches nested agent paths exactly, not by basename", () => {
    // A project with its own top-level "qa.md" must NOT suppress
    // ".cadre/agents/qa.md" — they are different files.
    const missing = missingScaffoldFiles(files, new Set(["qa.md"]));
    expect(missing.map((f) => f.path)).toContain(".cadre/agents/qa.md");
  });

  it("preserves the content of the files it returns, so callers can write them directly", () => {
    const missing = missingScaffoldFiles(files, new Set());
    const claude = missing.find((f) => f.path === "CLAUDE.md");
    expect(claude?.content).toContain("acme");
  });
});
