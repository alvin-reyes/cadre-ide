import { describe, it, expect } from "vitest";
import { toEntries } from "./contextStore";

// ---------------------------------------------------------------------------
// toEntries — pure helper tests
// ---------------------------------------------------------------------------

describe("toEntries", () => {
  it("returns an empty array when both inputs are empty", () => {
    expect(toEntries([], [])).toEqual([]);
  });

  it("tags context files with kind 'context'", () => {
    const entries = toEntries([{ name: "auth-api.md", content: "# Auth API" }], []);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("context");
    expect(entries[0].path).toBe(".cadre/context/auth-api.md");
    expect(entries[0].content).toBe("# Auth API");
  });

  it("sorts context files alphabetically", () => {
    const files = [
      { name: "z-zebra.md", content: "" },
      { name: "a-alpha.md", content: "" },
      { name: "m-middle.md", content: "" },
    ];
    const entries = toEntries(files, []);
    const names = entries.map((e) => e.path.split("/").pop());
    expect(names).toEqual(["a-alpha.md", "m-middle.md", "z-zebra.md"]);
  });

  it("tags ADR files with kind 'adr'", () => {
    const adrContent = `# 1. Use Postgres

_Date: 2025-01-01_

## Status

Accepted

## Context

We need a relational DB.

## Decision

Use Postgres.

## Consequences

Standard tooling.
`;
    const entries = toEntries([], [{ name: "0001-use-postgres.md", content: adrContent }]);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("adr");
    expect(entries[0].number).toBe(1);
    expect(entries[0].title).toBe("Use Postgres");
    expect(entries[0].status).toBe("Accepted");
    expect(entries[0].path).toBe(".cadre/context/decisions/0001-use-postgres.md");
  });

  it("sorts ADRs by number ascending", () => {
    const makeAdr = (n: number, title: string) => `# ${n}. ${title}\n\n_Date: 2025-01-01_\n\n## Status\n\nAccepted\n\n## Context\n\n.\n\n## Decision\n\n.\n\n## Consequences\n\n.\n`;

    const adrFiles = [
      { name: "0003-third.md", content: makeAdr(3, "Third") },
      { name: "0001-first.md", content: makeAdr(1, "First") },
      { name: "0002-second.md", content: makeAdr(2, "Second") },
    ];
    const entries = toEntries([], adrFiles);
    expect(entries.map((e) => e.number)).toEqual([1, 2, 3]);
  });

  it("places context files before ADRs", () => {
    const adrContent = `# 1. Some Decision\n\n_Date: 2025-01-01_\n\n## Status\n\nProposed\n\n## Context\n\n.\n\n## Decision\n\n.\n\n## Consequences\n\n.\n`;
    const entries = toEntries(
      [{ name: "shared-contracts.md", content: "# Contracts" }],
      [{ name: "0001-some-decision.md", content: adrContent }]
    );
    expect(entries[0].kind).toBe("context");
    expect(entries[1].kind).toBe("adr");
  });

  it("falls back to filename-derived number/title when parseAdr returns null", () => {
    // Content does not have the required "# N. title" heading
    const entries = toEntries([], [{ name: "0042-my-decision.md", content: "not valid adr content" }]);
    expect(entries).toHaveLength(1);
    expect(entries[0].number).toBe(42);
    expect(entries[0].title).toBe("my decision");
    expect(entries[0].status).toBeUndefined();
  });

  it("parses ADR status field correctly", () => {
    const makeAdr = (status: string) =>
      `# 1. Some ADR\n\n_Date: 2025-01-01_\n\n## Status\n\n${status}\n\n## Context\n\n.\n\n## Decision\n\n.\n\n## Consequences\n\n.\n`;

    for (const status of ["Proposed", "Accepted", "Superseded"] as const) {
      const entries = toEntries([], [{ name: "0001-some-adr.md", content: makeAdr(status) }]);
      expect(entries[0].status).toBe(status);
    }
  });

  it("does not mutate input arrays", () => {
    const contextFiles = [{ name: "b.md", content: "" }, { name: "a.md", content: "" }];
    const adrFiles = [{ name: "0002-b.md", content: "" }, { name: "0001-a.md", content: "" }];
    const origCtx = [...contextFiles];
    const origAdr = [...adrFiles];
    toEntries(contextFiles, adrFiles);
    expect(contextFiles).toEqual(origCtx);
    expect(adrFiles).toEqual(origAdr);
  });
});
