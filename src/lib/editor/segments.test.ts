import { describe, it, expect } from "vitest";
import { lineSegments, tokenClass } from "./segments";

describe("tokenClass", () => {
  it("collapses Monarch types to palette classes", () => {
    expect(tokenClass("keyword.go")).toBe("keyword");
    expect(tokenClass("string.escape.rust")).toBe("string");
    expect(tokenClass("number.hex.ts")).toBe("number");
    expect(tokenClass("comment.doc.go")).toBe("comment");
    expect(tokenClass("type.identifier.ts")).toBe("type");
    expect(tokenClass("variable.predefined.shell")).toBe("variable");
    expect(tokenClass("attribute.name.shell")).toBe("attribute"); // curl -X / --header
    expect(tokenClass("metatag.shell")).toBe("tag"); // shebang
    expect(tokenClass("regexp.ts")).toBe("regexp");
  });

  it("leaves identifiers, delimiters and unknowns unstyled", () => {
    expect(tokenClass("identifier.go")).toBeNull();
    expect(tokenClass("delimiter.parenthesis.python")).toBeNull();
    expect(tokenClass("")).toBeNull();
    expect(tokenClass("white.shell")).toBeNull();
  });
});

describe("lineSegments", () => {
  const join = (segs: { text: string }[]) => segs.map((s) => s.text).join("");

  it("slices the original line at token offsets", () => {
    const line = "func main() {";
    const segs = lineSegments(line, [
      { offset: 0, type: "keyword.go" },
      { offset: 4, type: "white.go" },
      { offset: 5, type: "identifier.go" },
      { offset: 9, type: "delimiter.parenthesis.go" },
    ]);
    expect(segs[0]).toEqual({ text: "func", cls: "keyword" });
    expect(join(segs)).toBe(line);
  });

  it("preserves tabs and spaces exactly (copy must paste into a real shell)", () => {
    const line = "\tcurl -X POST  -H 'Content-Type: application/json'";
    const segs = lineSegments(line, [
      { offset: 0, type: "white.shell" },
      { offset: 1, type: "keyword.shell" },
      { offset: 5, type: "white.shell" },
      { offset: 6, type: "attribute.name.shell" },
      { offset: 8, type: "white.shell" },
      { offset: 9, type: "string.shell" },
      { offset: 13, type: "white.shell" },
      { offset: 15, type: "attribute.name.shell" },
      { offset: 17, type: "white.shell" },
      { offset: 18, type: "string.shell" },
    ]);
    expect(join(segs)).toBe(line);
    expect(join(segs)).not.toContain(" ");
    expect(segs.find((s) => s.text === "-X")?.cls).toBe("attribute");
  });

  it("merges adjacent segments of the same class", () => {
    const segs = lineSegments("a.b", [
      { offset: 0, type: "identifier.ts" },
      { offset: 1, type: "delimiter.ts" },
      { offset: 2, type: "identifier.ts" },
    ]);
    expect(segs).toEqual([{ text: "a.b", cls: null }]);
  });

  it("keeps text before the first token and handles empty input", () => {
    expect(join(lineSegments("  x", [{ offset: 2, type: "keyword.py" }]))).toBe("  x");
    expect(lineSegments("", [{ offset: 0, type: "" }])).toEqual([]);
    expect(lineSegments("plain", [])).toEqual([{ text: "plain", cls: null }]);
  });

  it("handles non-ASCII without shifting offsets", () => {
    const line = 'print("héllo ✓")';
    const segs = lineSegments(line, [
      { offset: 0, type: "identifier.python" },
      { offset: 5, type: "delimiter.parenthesis.python" },
      { offset: 6, type: "string.python" },
      { offset: 15, type: "delimiter.parenthesis.python" },
    ]);
    expect(segs.find((s) => s.cls === "string")?.text).toBe('"héllo ✓"');
    expect(join(segs)).toBe(line);
  });
});
