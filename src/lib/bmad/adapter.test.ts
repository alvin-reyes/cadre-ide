import { describe, it, expect } from "vitest";
import { BmadAdapter, type BmadFileReader } from "./adapter";

// A fake .bmad-core, keyed by path relative to .bmad-core/.
const FILES: Record<string, string> = {
  "core-config.yaml": `prd:
  prdFile: docs/prd.md
  prdSharded: true
devStoryLocation: docs/stories
slashPrefix: BMad
`,
  "agents/dev.md": `# dev
\`\`\`yaml
agent:
  name: James
  id: dev
  title: Full Stack Developer
persona:
  role: Expert Senior Software Engineer
  core_principles:
    - Write the failing test first
\`\`\`
`,
  "templates/story-tmpl.yaml": `template:
  id: story-template-v2
  name: Story Document
sections:
  - id: status
    title: Status
    owner: scrum-master
    editors: [scrum-master, dev-agent]
`,
};

const reader: BmadFileReader = async (relPath) => {
  const content = FILES[relPath];
  if (content === undefined) throw new Error(`not found: ${relPath}`);
  return content;
};

describe("BmadAdapter", () => {
  it("loads and parses core-config", async () => {
    const adapter = new BmadAdapter(reader);
    const config = await adapter.loadConfig();
    expect(config.devStoryLocation).toBe("docs/stories");
    expect(config.prdSharded).toBe(true);
  });

  it("loads a persona by id", async () => {
    const adapter = new BmadAdapter(reader);
    const dev = await adapter.loadPersona("dev");
    expect(dev.id).toBe("dev");
    expect(dev.name).toBe("James");
  });

  it("loads a template by name", async () => {
    const adapter = new BmadAdapter(reader);
    const tmpl = await adapter.loadTemplate("story-tmpl");
    expect(tmpl.id).toBe("story-template-v2");
    expect(tmpl.sections.map((s) => s.id)).toContain("status");
  });

  it("composes a persona's system prompt in one step", async () => {
    const adapter = new BmadAdapter(reader);
    const prompt = await adapter.systemPromptFor("dev");
    expect(prompt).toContain("You are James, the Full Stack Developer.");
    expect(prompt).toContain("- Write the failing test first");
  });

  it("propagates a missing-file error", async () => {
    const adapter = new BmadAdapter(reader);
    await expect(adapter.loadPersona("nonexistent")).rejects.toThrow(
      /not found/
    );
  });
});
