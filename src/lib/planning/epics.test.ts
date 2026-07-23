import { describe, it, expect } from "vitest";
import { parseEpics } from "./epics";

describe("parseEpics", () => {
  it("parses bulleted epics with 'Epic N:' prefixes", () => {
    const prd = `# PRD\n\n## Goals\n- ship it\n\n## Epics\n- Epic 1: Authentication\n- Epic 2: Dashboard\n\n## Out of Scope\n- billing`;
    expect(parseEpics(prd)).toEqual([
      { number: 1, title: "Authentication" },
      { number: 2, title: "Dashboard" },
    ]);
  });

  it("parses heading-style epics and ignores indented sub-detail", () => {
    const prd = `## Epics\n### Onboarding\n  - collect email\n  - verify\n### Settings\n\n## Requirements`;
    expect(parseEpics(prd)).toEqual([
      { number: 1, title: "Onboarding" },
      { number: 2, title: "Settings" },
    ]);
  });

  it("renumbers sequentially regardless of stated numbers, unwraps bold", () => {
    const prd = `## Epics\n1. **Core loop**\n2. Payments`;
    expect(parseEpics(prd)).toEqual([
      { number: 1, title: "Core loop" },
      { number: 2, title: "Payments" },
    ]);
  });

  it("returns [] when there's no Epics section", () => {
    expect(parseEpics("# PRD\n\n## Goals\n- x")).toEqual([]);
  });
});
