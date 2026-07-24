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

  it("parseAdr returns null for non-ADR markdown", () => {
    expect(parseAdr("# Just a doc\n\nnope")).toBeNull();
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
