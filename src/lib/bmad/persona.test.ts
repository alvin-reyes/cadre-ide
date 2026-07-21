import { describe, it, expect } from "vitest";
import { extractYamlBlock, parsePersona } from "./persona";

// Mirrors the real BMAD v4 persona shape (see resources/bmad-core/agents/dev.md).
const SAMPLE = [
  "<!-- Powered by BMAD Core -->",
  "# dev",
  "```yaml",
  "agent:",
  "  name: James",
  "  id: dev",
  "  title: Full Stack Developer",
  "  icon: D",
  "  whenToUse: 'Use for code implementation, debugging, refactoring'",
  "persona:",
  "  role: Expert Senior Software Engineer",
  "  style: Concise, pragmatic",
  "  core_principles:",
  "    - Write the failing test first",
  "    - Never mark done without green tests",
  "commands:",
  "  - help: Show numbered list of commands",
  "  - develop-story: Implement the assigned story",
  "dependencies:",
  "  tasks:",
  "    - execute-checklist.md",
  "  checklists:",
  "    - story-dod-checklist.md",
  "```",
].join("\n");

describe("extractYamlBlock", () => {
  it("returns the content inside the yaml fence", () => {
    const yaml = extractYamlBlock(SAMPLE);
    expect(yaml).toContain("id: dev");
    expect(yaml).not.toContain("```");
    expect(yaml).not.toContain("Powered by BMAD");
  });

  it("throws when there is no yaml block", () => {
    expect(() => extractYamlBlock("# just a heading, no block")).toThrow();
  });
});

describe("parsePersona", () => {
  it("extracts the agent identity", () => {
    const p = parsePersona(SAMPLE);
    expect(p.id).toBe("dev");
    expect(p.name).toBe("James");
    expect(p.title).toBe("Full Stack Developer");
    expect(p.whenToUse).toContain("code implementation");
  });

  it("extracts the persona role and principles", () => {
    const p = parsePersona(SAMPLE);
    expect(p.persona.role).toBe("Expert Senior Software Engineer");
    expect(p.persona.core_principles).toContain("Write the failing test first");
  });

  it("extracts lazy dependencies", () => {
    const p = parsePersona(SAMPLE);
    expect(p.dependencies?.tasks).toContain("execute-checklist.md");
    expect(p.dependencies?.checklists).toContain("story-dod-checklist.md");
  });

  it("throws when agent.id is missing", () => {
    const bad = ["```yaml", "persona:", "  role: x", "```"].join("\n");
    expect(() => parsePersona(bad)).toThrow(/agent.id/);
  });
});
