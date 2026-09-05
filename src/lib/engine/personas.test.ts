/**
 * personas.test.ts — regression guard for the two-faces drift.
 *
 * These constants were duplicated in useCadre.ts and cli/cadre.ts and had already
 * diverged: the CLI copy lacked the DECISION MEMORY paragraph, so `cadre run`
 * dispatched agents that had never been told ADRs exist. These assertions pin the
 * directives a Dev agent must receive on BOTH faces — they are not restating the
 * string, they are the contract dispatch depends on.
 */
import { describe, it, expect } from "vitest";
import { DEV_SYSTEM_PROMPT, SM_SYSTEM_PROMPT } from "./personas";
import { ADR_DECISIONS_DIR } from "./adr";
import { CONTEXT_STORE_DIR } from "./sharedContext";

describe("DEV_SYSTEM_PROMPT", () => {
  it("tells the agent never to self-report done — the load-bearing invariant", () => {
    expect(DEV_SYSTEM_PROMPT).toMatch(/Do NOT mark the story done/);
  });

  it("points the agent at the Context Store for shared contracts", () => {
    expect(DEV_SYSTEM_PROMPT).toContain(CONTEXT_STORE_DIR);
  });

  it("points the agent at the ADR directory — the paragraph the CLI face was missing", () => {
    expect(DEV_SYSTEM_PROMPT).toContain(ADR_DECISIONS_DIR);
    expect(DEV_SYSTEM_PROMPT).toMatch(/do not silently re-decide/);
  });

  it("requires test-first work", () => {
    expect(DEV_SYSTEM_PROMPT).toMatch(/test-first/);
  });
});

describe("SM_SYSTEM_PROMPT", () => {
  it("requires file-disjoint stories, which is what makes parallel dispatch safe", () => {
    expect(SM_SYSTEM_PROMPT).toMatch(/FILE-DISJOINT/);
  });

  it("requires a Definition of Done", () => {
    expect(SM_SYSTEM_PROMPT).toMatch(/Definition of Done/);
  });
});
