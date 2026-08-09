import { describe, it, expect } from "vitest";
import { parseFindings, severityRank } from "./evaluation";

describe("parseFindings", () => {
  it("parses a clean JSON array", () => {
    const raw = '[{"severity":"critical","title":"Secret committed","detail":"api key in config.ts"}]';
    expect(parseFindings(raw)).toEqual([{ severity: "critical", title: "Secret committed", detail: "api key in config.ts" }]);
  });
  it("tolerates prose + ```json fences around the array", () => {
    const raw = "Here are my findings:\n```json\n[{\"severity\":\"warning\",\"title\":\"No tests\",\"detail\":\"x\"}]\n```\ndone";
    expect(parseFindings(raw).map((f) => f.title)).toEqual(["No tests"]);
  });
  it("defaults an unknown severity to warning and drops title-less items", () => {
    const raw = '[{"severity":"nope","title":"T","detail":"d"},{"detail":"no title"}]';
    expect(parseFindings(raw)).toEqual([{ severity: "warning", title: "T", detail: "d" }]);
  });
  it("returns [] for an empty array or unparseable output", () => {
    expect(parseFindings("[]")).toEqual([]);
    expect(parseFindings("no json here")).toEqual([]);
    expect(parseFindings("[ broken")).toEqual([]);
  });
  it("severityRank orders critical < warning < info", () => {
    expect(severityRank("critical")).toBeLessThan(severityRank("warning"));
    expect(severityRank("warning")).toBeLessThan(severityRank("info"));
  });
});
