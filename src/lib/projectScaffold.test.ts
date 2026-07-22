import { describe, it, expect } from "vitest";
import { scaffoldFiles } from "./projectScaffold";

describe("scaffoldFiles", () => {
  it("ships CLAUDE.md, llms.txt, and the BMAD agent prompts", () => {
    const files = scaffoldFiles("acme");
    const paths = files.map((f) => f.path);

    expect(paths).toContain("CLAUDE.md");
    expect(paths).toContain("llms.txt");
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
});
