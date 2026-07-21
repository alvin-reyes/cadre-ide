import { describe, it, expect } from "vitest";
import { planningSystemPrompt } from "./planningPrompt";
import type { BmadPersona } from "../bmad/persona";
import type { BmadTemplate } from "../bmad/template";

const pm: BmadPersona = {
  id: "pm",
  name: "John",
  title: "Product Manager",
  persona: { role: "Product Manager", core_principles: ["Outcome-focused"] },
  commands: [],
  raw: {},
};

const prdTemplate: BmadTemplate = {
  id: "prd",
  name: "PRD",
  sections: [
    { id: "goals", title: "Goals", editors: [] },
    { id: "requirements", title: "Requirements", editors: [] },
    { id: "epics", title: "Epics", editors: [] },
  ],
  raw: {},
};

describe("planningSystemPrompt", () => {
  it("leads with the persona identity", () => {
    const p = planningSystemPrompt(pm, prdTemplate, "PRD");
    expect(p).toContain("You are John, the Product Manager.");
  });

  it("names the artifact being produced", () => {
    const p = planningSystemPrompt(pm, prdTemplate, "PRD");
    expect(p).toContain("producing the project's PRD");
  });

  it("lists the template's required sections", () => {
    const p = planningSystemPrompt(pm, prdTemplate, "PRD");
    expect(p).toContain("- Goals");
    expect(p).toContain("- Requirements");
    expect(p).toContain("- Epics");
  });
});
