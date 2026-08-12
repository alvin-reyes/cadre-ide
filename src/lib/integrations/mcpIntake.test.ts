import { describe, it, expect } from "vitest";
import { buildFetchPrompt, parseTicket, ticketToBrief } from "./mcpIntake";

describe("mcpIntake core", () => {
  it("buildFetchPrompt names the ticket, is read-only, demands strict JSON", () => {
    const p = buildFetchPrompt("TCK-42");
    expect(p).toContain("TCK-42");
    expect(p).toMatch(/read|do not (modify|change|write)/i);
    expect(p).toMatch(/only.*json/i);
    expect(p).toMatch(/id|title|description|acceptance/i);
  });
  it("parseTicket extracts JSON (prose-wrapped, nested), requires id + title", () => {
    // Fixed: parseTicket returns ONLY known fields, no meta key
    expect(parseTicket('here: {"id":"T-1","title":"Add login","description":"d","meta":{"a":1}}')).toEqual({
      id: "T-1",
      title: "Add login",
      description: "d",
    });
    expect(() => parseTicket('{"id":"T-1"}')).toThrow(); // missing title
    expect(() => parseTicket("no json")).toThrow();
  });
  it("ticketToBrief includes title, description, acceptance, provenance footer", () => {
    const b = ticketToBrief({
      id: "T-1",
      title: "Add login",
      description: "users log in",
      acceptanceCriteria: "email+pw",
    });
    expect(b).toContain("Add login");
    expect(b).toContain("users log in");
    expect(b).toContain("email+pw");
    expect(b).toMatch(/imported from tracker.*T-1/i);
  });
});
