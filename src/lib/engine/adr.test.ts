import { describe, it, expect } from "vitest";
import {
  adrFilename,
  nextAdrNumber,
  composeAdr,
  parseAdr,
  parseAdrIndex,
  ADR_DECISIONS_DIR,
  type Adr,
} from "./adr";

const sample: Adr = {
  number: 2,
  title: "Use Postgres",
  status: "Accepted",
  date: "2026-07-24",
  context: "We need durable storage.",
  decision: "Adopt Postgres.",
  consequences: "Ops must run a DB.",
};

describe("adr", () => {
  it("filenames are zero-padded + slugified under the decisions dir", () => {
    expect(adrFilename(2, "Use Postgres")).toBe(
      `${ADR_DECISIONS_DIR}/0002-use-postgres.md`
    );
    expect(adrFilename(13, "Async Job Queue!")).toBe(
      `${ADR_DECISIONS_DIR}/0013-async-job-queue.md`
    );
  });

  it("nextAdrNumber is max+1 (or 1 when empty)", () => {
    expect(nextAdrNumber([1, 2, 5])).toBe(6);
    expect(nextAdrNumber([])).toBe(1);
  });

  it("composeAdr round-trips through parseAdr", () => {
    const md = composeAdr(sample);
    expect(md).toContain("# 2. Use Postgres");
    expect(md).toContain("Accepted");
    const back = parseAdr(md);
    expect(back).toMatchObject({
      number: 2,
      title: "Use Postgres",
      status: "Accepted",
      context: "We need durable storage.",
      decision: "Adopt Postgres.",
      consequences: "Ops must run a DB.",
    });
  });

  it("round-trips bodies that contain subheadings and multiple paragraphs (lossless)", () => {
    const rich: Adr = {
      number: 7,
      title: "Adopt event sourcing",
      status: "Accepted",
      date: "2026-07-24",
      context:
        "We need an audit trail.\n\n## Options considered\n\n- CRUD + audit log\n- Event sourcing\n\nBoth were prototyped.",
      decision: "Go with event sourcing.\n\n# Rationale\n\nReplayability wins.",
      consequences: "Higher complexity.\n\n## Mitigations\n\nUse a mature library.",
    };
    const back = parseAdr(composeAdr(rich));
    // Every section body must survive verbatim, including its inner `#`/`##` lines.
    expect(back).toMatchObject({
      number: 7,
      title: "Adopt event sourcing",
      status: "Accepted",
      context: rich.context,
      decision: rich.decision,
      consequences: rich.consequences,
    });
  });

  it("round-trips all three statuses", () => {
    for (const status of ["Proposed", "Accepted", "Superseded"] as const) {
      expect(parseAdr(composeAdr({ ...sample, status }))?.status).toBe(status);
    }
  });

  it("parseAdr returns null for non-ADR markdown", () => {
    expect(parseAdr("# Just a doc\n\nnope")).toBeNull();
  });

  it("parseAdr rejects a changelog-style heading with no Status section", () => {
    expect(parseAdr("# 1. Fixed a bug\n\nsome notes")).toBeNull();
  });

  it("parseAdrIndex reads number+slug from filenames, sorted", () => {
    expect(
      parseAdrIndex(["0002-b.md", "0001-a.md", "readme.md"])
    ).toEqual([
      { number: 1, slug: "a" },
      { number: 2, slug: "b" },
    ]);
  });
});
