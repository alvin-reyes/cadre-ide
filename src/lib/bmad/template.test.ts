import { describe, it, expect } from "vitest";
import { parseTemplate, canEdit } from "./template";

// Structurally faithful to resources/bmad-core/templates/story-tmpl.yaml,
// including a nested section (Dev Agent Record > File List).
const STORY_TMPL = `template:
  id: story-template-v2
  name: Story Document
  version: 2.0
  output:
    format: markdown
    filename: docs/stories/{{epic_num}}.{{story_num}}.{{story_title_short}}.md
    title: "Story {{epic_num}}.{{story_num}}"
sections:
  - id: status
    title: Status
    owner: scrum-master
    editors: [scrum-master, dev-agent]
  - id: dev-agent-record
    title: Dev Agent Record
    owner: dev-agent
    editors: [dev-agent]
    sections:
      - id: file-list
        title: File List
        owner: dev-agent
        editors: [dev-agent]
  - id: qa-results
    title: QA Results
    owner: qa-agent
    editors: [qa-agent]
`;

describe("parseTemplate", () => {
  it("reads template metadata and output pattern", () => {
    const t = parseTemplate(STORY_TMPL);
    expect(t.id).toBe("story-template-v2");
    expect(t.name).toBe("Story Document");
    expect(t.outputFilename).toContain("docs/stories/");
    expect(t.outputTitle).toContain("Story");
  });

  it("flattens nested sections in order", () => {
    const t = parseTemplate(STORY_TMPL);
    const ids = t.sections.map((s) => s.id);
    expect(ids).toEqual(["status", "dev-agent-record", "file-list", "qa-results"]);
  });

  it("captures owner and editors per section", () => {
    const t = parseTemplate(STORY_TMPL);
    const status = t.sections.find((s) => s.id === "status")!;
    expect(status.owner).toBe("scrum-master");
    expect(status.editors).toEqual(["scrum-master", "dev-agent"]);
    const qa = t.sections.find((s) => s.id === "qa-results")!;
    expect(qa.owner).toBe("qa-agent");
  });
});

describe("canEdit", () => {
  it("allows an editor listed for the section", () => {
    const t = parseTemplate(STORY_TMPL);
    expect(canEdit(t, "status", "dev-agent")).toBe(true);
    expect(canEdit(t, "qa-results", "qa-agent")).toBe(true);
  });

  it("denies a role not listed as an editor", () => {
    const t = parseTemplate(STORY_TMPL);
    expect(canEdit(t, "status", "qa-agent")).toBe(false);
    expect(canEdit(t, "qa-results", "dev-agent")).toBe(false);
  });

  it("denies an unknown section", () => {
    const t = parseTemplate(STORY_TMPL);
    expect(canEdit(t, "nonexistent", "dev-agent")).toBe(false);
  });
});
