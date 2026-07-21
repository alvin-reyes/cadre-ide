import { describe, it, expect } from "vitest";
import { composeSystemPrompt } from "./prompt";
import type { BmadPersona } from "./persona";

const DEV: BmadPersona = {
  id: "dev",
  name: "James",
  title: "Full Stack Developer",
  persona: {
    role: "Expert Senior Software Engineer",
    style: "Concise, pragmatic",
    identity: "Implementation specialist who writes tests first",
    focus: "Executing stories with precision",
    core_principles: [
      "Write the failing test first",
      "Never mark a story done without green tests",
    ],
  },
  commands: [],
  raw: {},
};

describe("composeSystemPrompt", () => {
  it("leads with the persona identity", () => {
    const prompt = composeSystemPrompt(DEV);
    expect(prompt.startsWith("You are James, the Full Stack Developer.")).toBe(
      true
    );
  });

  it("includes role, style, identity and focus", () => {
    const prompt = composeSystemPrompt(DEV);
    expect(prompt).toContain("Role: Expert Senior Software Engineer");
    expect(prompt).toContain("Style: Concise, pragmatic");
    expect(prompt).toContain("Identity: Implementation specialist");
    expect(prompt).toContain("Focus: Executing stories");
  });

  it("lists the core principles", () => {
    const prompt = composeSystemPrompt(DEV);
    expect(prompt).toContain("- Write the failing test first");
    expect(prompt).toContain("- Never mark a story done without green tests");
  });

  it("tells the model to stay in character and follow the method", () => {
    const prompt = composeSystemPrompt(DEV);
    expect(prompt).toContain("Stay in character as James");
    expect(prompt).toContain("Follow the BMAD method");
  });

  it("omits the title clause when there is no title", () => {
    const prompt = composeSystemPrompt({ ...DEV, title: "" });
    expect(prompt.startsWith("You are James.")).toBe(true);
  });
});
